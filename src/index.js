// homebridge-teslapowerwall-accfactory
//
// reference for details: https://github.com/vloschiavo/powerwall2?tab=readme-ov-file
//
// Expose "outlet" service with additonal battery service
//  Outlet On = Powerwall discharing
//  Outlet Off = Powerwall off or charging
//
//  Battery Level = Percentage of battery charge
//  Battery Charging Yes = Battery is being charged
//  Battery Charging No = Battery is not being charge
//  Low battery indicator = ????
//
// Code version 2025/06/17
// Mark Hulskamp
'use strict';

// Define nodejs module requirements
import { clearInterval, setTimeout, clearTimeout } from 'node:timers';
import crypto from 'node:crypto';
import { Agent, setGlobalDispatcher } from 'undici';

// Import our modules
import HomeKitDevice from './HomeKitDevice.js';
HomeKitDevice.PLUGIN_NAME = 'homebridge-teslapowerwall-accfactory';
HomeKitDevice.PLATFORM_NAME = 'TeslaPowerwallAccfactory';

import HomeKitHistory from './HomeKitHistory.js';
HomeKitDevice.HISTORY = HomeKitHistory;

// Define constants
const MIN_WATTS = 100;

// Powerwall class
class Powerwall extends HomeKitDevice {
  static TYPE = 'TeslaPowerwall';
  static VERSION = '2025.06.17';

  batteryService = undefined;
  outletService = undefined;

  // Class functions
  onAdd() {
    // Setup the outlet service if not already present on the accessory
    this.outletService = this.addHKService(this.hap.Service.Outlet, '', 1);
    this.outletService.setPrimaryService();

    // Setup set characteristics
    this.addHKCharacteristic(this.outletService, this.hap.Characteristic.On, {
      // eslint-disable-next-line no-unused-vars
      onSet: (value) => {
        // Reject manual changes
        setTimeout(() => {
          this.outletService.updateCharacteristic(this.hap.Characteristic.On, this.deviceData.p_out > MIN_WATTS ? true : false);
        }, 100);
      },
    });

    // Setup battery service if not already present on the accessory
    this.batteryService = this.addHKService(this.hap.Service.Battery, '', 1);
    this.batteryService.setHiddenService(true);

    // Setup linkage to EveHome app if configured todo so
    if (
      this.deviceData?.eveHistory === true &&
      this.outletService !== undefined &&
      typeof this.historyService?.linkToEveHome === 'function'
    ) {
      this.historyService.linkToEveHome(this.outletService, {
        description: this.deviceData.description,
        getcommand: this.#EveHomeGetcommand.bind(this),
      });
    }
  }

  onUpdate(deviceData) {
    if (typeof deviceData !== 'object' || this.outletService === undefined || this.batteryService === undefined) {
      return;
    }

    // If device isn't online report in HomeKit
    this.outletService.updateCharacteristic(
      this.hap.Characteristic.StatusFault,
      deviceData.online === true ? this.hap.Characteristic.StatusFault.NO_FAULT : this.hap.Characteristic.StatusFault.GENERAL_FAULT,
    );

    // Update energy flows
    this.outletService.updateCharacteristic(this.hap.Characteristic.On, deviceData.p_out > MIN_WATTS ? true : false);
    this.outletService.updateCharacteristic(this.hap.Characteristic.OutletInUse, deviceData.p_out > MIN_WATTS ? true : false);

    // Update battery level and status
    let batteryLevel = scaleValue(deviceData.nominal_energy_remaining, 0, deviceData.nominal_full_pack_energy, 0, 100);
    this.batteryService.updateCharacteristic(this.hap.Characteristic.BatteryLevel, batteryLevel);
    this.batteryService.updateCharacteristic(
      this.hap.Characteristic.ChargingState,
      deviceData.p_out < 0 ? this.hap.Characteristic.ChargingState.CHARGING : this.hap.Characteristic.ChargingState.NOT_CHARGING,
    );
    this.batteryService.updateCharacteristic(
      this.hap.Characteristic.StatusLowBattery,
      batteryLevel < deviceData.backup_reserve_percent
        ? this.hap.Characteristic.StatusLowBattery.BATTERY_LEVEL_LOW
        : this.hap.Characteristic.StatusLowBattery.BATTERY_LEVEL_NORMAL,
    );

    // If we have the history service running and power output has changed to previous in past 2mins
    if (this.outletService !== undefined && typeof this.historyService?.addHistory === 'function') {
      this.historyService.addHistory(
        this.outletService,
        {
          time: Math.floor(Date.now() / 1000),
          status: deviceData.p_out > MIN_WATTS ? 1 : 0,
          volts: deviceData.p_out > MIN_WATTS && deviceData.v_out > MIN_WATTS ? deviceData.v_out : 0,
          watts: deviceData.p_out > MIN_WATTS ? deviceData.p_out : 0,
          amps: deviceData.p_out > MIN_WATTS && deviceData.i_out > 0 ? deviceData.i_out : 0,
        },
        120,
      );
    }

    // Notify Eve App of device status changes if linked
    if (
      this.deviceData.eveHistory === true &&
      this.outletService !== undefined &&
      typeof this.historyService?.updateEveHome === 'function'
    ) {
      // Update our internal data with properties Eve will need to process
      this.deviceData.v_out = deviceData.v_out;
      this.deviceData.p_out = deviceData.p_out;
      this.deviceData.i_out = deviceData.i_out;
      this.historyService.updateEveHome(this.outletService, this.#EveHomeGetcommand.bind(this));
    }
  }

  #EveHomeGetcommand(EveHomeGetData) {
    // Pass back extra data for Eve Energy onGet() to process command
    // Data will already be an object, our only job is to add/modify it
    if (typeof EveHomeGetData === 'object') {
      EveHomeGetData.volts = this.deviceData.p_out > 0 && this.deviceData.v_out > 0 ? this.deviceData.v_out : 0; // Only report voltage if watts are flowing
      EveHomeGetData.watts = this.deviceData.p_out > 0 ? this.deviceData.p_out : 0;
      EveHomeGetData.amps = this.deviceData.p_out > 0 && this.deviceData.i_out > 0 ? this.deviceData.i_out : 0; // Only report current if watts are flowing
    }

    return EveHomeGetData;
  }
}

// eslint-disable-next-line no-unused-vars
class Gateway extends HomeKitDevice {
  static TYPE = 'TeslaGateway';
  static VERSION = '2025.06.17';

  batteryService = undefined;
  outletService = undefined;
  lightService = undefined;

  // Class functions
  onAdd() {
    // Setup the outlet service if not already present on the accessory
    this.outletService = this.addHKService(this.hap.Service.Outlet, '', 1);
    this.outletService.setPrimaryService();

    // Setup set characteristics
    this.addHKCharacteristic(this.outletService, this.hap.Characteristic.On, {
      // eslint-disable-next-line no-unused-vars
      onSet: (value) => {
        // Reject manual changes
        setTimeout(() => {
          this.outletService.updateCharacteristic(this.deviceData?.powerflow?.battery?.instant_power >= MIN_WATTS ? true : false);
        }, 100);
      },
    });

    // Below doesnt appear to change anything in HomeKit, but we'll do it anyway. maybe for future
    this.outletService.getCharacteristic(this.hap.Characteristic.CurrentAmbientLightLevel).displayName = 'Solar Generation';
    this.outletService.getCharacteristic(this.hap.Characteristic.BatteryLevel).displayName = 'Solar Generation';
    this.outletService.getCharacteristic(this.hap.Characteristic.ChargingState).displayName = 'Exporting';

    // Setup the battery service if not already present on the accessory
    this.batteryService = this.addHKService(this.hap.Service.Battery, '', 1);
    this.batteryService.setHiddenService(true);

    // Setup LightSensor service for solar generation LUX
    this.lightService = this.addHKService(this.hap.Service.LightSensor, '', 1);
    this.lightService.setHiddenService(true);

    this.addHKCharacteristic(this.lightService, this.hap.Characteristic.CurrentAmbientLightLevel);

    // Setup linkage to EveHome app if configured todo so
    if (
      this.deviceData?.eveHistory === true &&
      this.outletService !== undefined &&
      typeof this.historyService?.linkToEveHome === 'function'
    ) {
      this.historyService.linkToEveHome(this.outletService, {
        description: this.deviceData.description,
        getcommand: this.#EveHomeGetcommand.bind(this),
      });
    }
  }

  onUpdate(deviceData) {
    if (typeof deviceData !== 'object' || this.outletService === undefined || this.batteryService === undefined) {
      return;
    }

    if (typeof deviceData?.powerflow?.battery === 'object') {
      if (deviceData.powerflow.battery.instant_power >= MIN_WATTS) {
        // Over "minwatts" coming from battery, we assume using battery power to either house or grid
        // Using this as metric seems to smooth out the small discharges seen from app
        this.batteryService.updateCharacteristic(this.hap.Characteristic.ChargingState, this.hap.Characteristic.ChargingState.NOT_CHARGING);
        this.outletService.updateCharacteristic(this.hap.Characteristic.On, true);
      } else if (deviceData.powerflow.battery.instant_power > 0) {
        this.batteryService.updateCharacteristic(this.hap.Characteristic.ChargingState, this.hap.Characteristic.ChargingState.NOT_CHARGING);
        this.outletService.updateCharacteristic(this.hap.Characteristic.On, false);
      } else {
        if (scaleValue(deviceData.nominal_energy_remaining, 0, deviceData.nominal_full_pack_energy, 0, 100) < 100) {
          // Power going to battery and charged battery percentage is less than 100%
          this.batteryService.updateCharacteristic(this.hap.Characteristic.ChargingState, this.hap.Characteristic.ChargingState.CHARGING);
        } else {
          // Battery is at 100%, so not charging
          this.batteryService.updateCharacteristic(
            this.hap.Characteristic.ChargingState,
            this.hap.Characteristic.ChargingState.NOT_CHARGING,
          );
        }
        this.outletService.updateCharacteristic(this.hap.Characteristic.On, false);
      }
    }

    this.batteryService.updateCharacteristic(
      this.hap.Characteristic.StatusLowBattery,
      scaleValue(deviceData.nominal_energy_remaining, 0, deviceData.nominal_full_pack_energy, 0, 100) < deviceData.backup_reserve_percent
        ? this.hap.Characteristic.StatusLowBattery.BATTERY_LEVEL_LOW
        : this.hap.Characteristic.StatusLowBattery.BATTERY_LEVEL_NORMAL,
    );

    // Solar generation in watts as a LUX reading
    this.lightService.updateCharacteristic(
      this.hap.Characteristic.CurrentAmbientLightLevel,
      deviceData.powerflow.solar && deviceData.powerflow.solar.instant_power > 0 ? deviceData.powerflow.solar.instant_power : 0.0001,
    );
  }

  #EveHomeGetcommand(EveHomeGetData) {
    // Pass back extra data for Eve Energy onGet() to process command
    // Data will already be an object, our only job is to add/modify it
    if (typeof EveHomeGetData === 'object') {
      //
    }

    return EveHomeGetData;
  }
}

// Telsa class
const SUBSCRIBE_INTERVAL = 15000; // Get system details every 2 seconds

class TeslaPowerwallAccfactory {
  static DeviceType = {
    GATEWAY: 'gateway',
    POWERWALL: 'powerwall',
  };

  cachedAccessories = []; // Track restored cached accessories

  // Internal data only for this class
  #connections = {}; // Object of confirmed connections
  #rawData = {}; // Cached copy of data from Rest APIm
  #trackedDevices = {}; // Object of devices we've created. used to track comms uuid. key'd by serial #

  constructor(log, config, api) {
    this.config = config;
    this.log = log;
    this.api = api;

    // Perform validation on the configuration passed into us and set defaults if not present

    // Build our connection object. Allows us to have multiple diffent account connections under the one accessory
    if (Array.isArray(config?.gateways) === true) {
      config.gateways.forEach((value) => {
        if (
          value?.gateway !== undefined &&
          value?.gateway !== '' &&
          value?.email !== undefined &&
          value?.email !== '' &&
          value?.password !== undefined &&
          value?.password !== ''
        ) {
          // Valid connection object
          this.#connections[crypto.randomUUID()] = {
            authorised: false,
            retry: true,
            timer: undefined,
            gateway: value.gateway,
            username: value?.username !== undefined && value.username !== '' ? value.username : 'customer',
            email: value.email,
            password: value.password,
          };
        }
      });
    }

    this.config.options.eveHistory = typeof this.config.options?.eveHistory === 'boolean' ? this.config.options.eveHistory : true;

    this?.api?.on?.('didFinishLaunching', async () => {
      // We got notified that Homebridge has finished loading, so we are ready to process
      // Start reconnect loop per connection with backoff for failed tries
      for (const uuid of Object.keys(this.#connections)) {
        let reconnectDelay = 15000;

        const reconnectLoop = async () => {
          if (this.#connections?.[uuid]?.authorised === false && this.#connections?.[uuid]?.retry !== false) {
            try {
              await this.#connect(uuid);
              this.#subscribeREST(uuid);
              // eslint-disable-next-line no-unused-vars
            } catch (error) {
              // Empty
            }

            reconnectDelay = this.#connections?.[uuid]?.authorised === true ? 15000 : Math.min(reconnectDelay * 2, 60000);
          } else {
            reconnectDelay = 15000;
          }

          setTimeout(reconnectLoop, reconnectDelay);
        };

        reconnectLoop();
      }
    });

    this?.api?.on?.('shutdown', async () => {
      // We got notified that Homebridge is shutting down
      // Perform cleanup of internal state
      Object.values(this.#trackedDevices).forEach((device) => {
        Object.values(device?.timers || {}).forEach((timer) => clearInterval(timer));
      });

      this.#trackedDevices = {};
      this.#rawData = {};
    });
  }

  configureAccessory(accessory) {
    // This gets called from Homebridge each time it restores an accessory from its cache
    this?.log?.info && this.log.info('Loading accessory from cache:', accessory.displayName);

    // add the restored accessory to the accessories cache, so we can track if it has already been registered
    this.cachedAccessories.push(accessory);
  }

  async #connect(uuid) {
    if (typeof this.#connections?.[uuid] === 'object') {
      this?.log?.info?.('Performing authorisation to Tesla Gateway at "%s"', this.#connections[uuid].gateway);

      try {
        let response = await fetchWrapper(
          'post',
          'https://' + this.#connections[uuid].gateway + '/api/login/Basic',
          {},
          JSON.stringify({
            username: this.#connections[uuid].username,
            password: this.#connections[uuid].password,
            email: this.#connections[uuid].email,
          }),
        );

        let data = await response.json();
        this.#connections[uuid].authorised = true;
        this.#connections[uuid].token = data.token;

        clearTimeout(this.#connections[uuid].timer);
        this.#connections[uuid].timer = setTimeout(
          () => {
            this?.log?.info?.('Performing periodic re-authorisation to Tesla Gateway "%s"', this.#connections[uuid].gateway);
            this.#connect(uuid);
          },
          1000 * 3600 * 24,
        ); // Refresh token every 24hrs

        this?.log?.success?.('Successfully authorised to Tesla Gateway "%s"', this.#connections[uuid].gateway);
      } catch (error) {
        this.#connections[uuid].authorised = false;

        let errorCode = error?.cause?.code;

        if (errorCode === 'ENOTFOUND') {
          this?.log?.error?.(
            'Specified Tesla Gateway "%s" could not be found. Please check your configuration',
            this.#connections[uuid].gateway,
          );
          this.#connections[uuid].retry = false;
          return;
        }

        if (typeof errorCode === 'string' && errorCode.includes('TIMEOUT') === true) {
          this?.log?.error?.(
            'Failed to connect to Tesla Gateway "%s". A periodic retry event will be triggered',
            this.#connections[uuid].gateway,
          );
          this.#connections[uuid].retry = true;
          return;
        }

        this?.log?.error?.(
          'Authorisation failed to Tesla Gateway "%s": %s',
          this.#connections[uuid].gateway,
          String(error?.cause || error),
        );
        this.#connections[uuid].retry = true;
      }
    }
  }

  async #subscribeREST(uuid) {
    if (typeof this.#connections?.[uuid] !== 'object' || this.#connections?.[uuid]?.authorised !== true) {
      // Not a valid connection object and/or we're not authorised
      return;
    }

    let fetchUrls = [
      '/api/networks',
      '/api/status',
      '/api/powerwalls',
      '/api/meters/aggregates',
      '/api/system_status',
      '/api/operation',
      '/api/solars',
    ];

    let tempObject = {};

    await Promise.all(
      fetchUrls.map(async (url) => {
        try {
          let response = await fetchWrapper('get', 'https://' + this.#connections[uuid].gateway + url, {
            headers: {
              'content-type': 'application/json',
              cookie: 'AuthCookie=' + this.#connections[uuid].token,
            },
          });

          let text = await response.text();
          try {
            tempObject[url] = text.trim() === '' ? {} : JSON.parse(text);
          } catch {
            // silently skip if invalid JSON
          }
        } catch (error) {
          if (
            String(error?.cause || error)
              .toUpperCase()
              .includes('TIMEOUT') === false &&
            this?.log?.debug
          ) {
            this.log.debug('REST API had an error obtaining data from url "%s" for uuid "%s"', url, uuid);
            this.log.debug('Error was "%s"', String(error?.cause || error));
          }
        }
      }),
    );

    if (Object.keys(tempObject).length === fetchUrls.length) {
      // We got all the data required, so now can process what we retrieved
      this.#rawData[uuid] = {
        powerwalls: tempObject['/api/powerwalls'],
        gateway: tempObject['/api/status'],
        powerflow: tempObject['/api/meters/aggregates'],
        status: tempObject['/api/system_status'],
        operation: tempObject['/api/operation'],
        networks: tempObject['/api/networks'],
        solar: tempObject['/api/solars'],
      };

      await this.#processPostSubscribe();
    }

    // Redo data gathering again after specified timeout
    setTimeout(this.#subscribeREST.bind(this, uuid), SUBSCRIBE_INTERVAL);
  }

  #processPostSubscribe() {
    Object.values(this.#processData('')).forEach((deviceData) => {
      if (this.#trackedDevices?.[deviceData?.serialNumber] === undefined && deviceData?.excluded === true) {
        // We haven't tracked this device before (ie: should be a new one) and but its excluded
        this?.log?.warn?.('Device "%s" is ignored due to it being marked as excluded', deviceData.description);

        // Track this device even though its excluded
        this.#trackedDevices[deviceData.serialNumber] = {
          uuid: HomeKitDevice.generateUUID(HomeKitDevice.PLUGIN_NAME, this.api, deviceData.serialNumber),
          timers: undefined,
          exclude: true,
        };

        // If the device is now marked as excluded and present in accessory cache
        // Then we'll unregister it from the Homebridge platform
        let accessory = this.cachedAccessories.find((accessory) => accessory?.UUID === this.#trackedDevices[deviceData.serialNumber].uuid);
        if (accessory !== undefined && typeof accessory === 'object') {
          this.api.unregisterPlatformAccessories(HomeKitDevice.PLUGIN_NAME, HomeKitDevice.PLATFORM_NAME, [accessory]);
        }
      }

      if (this.#trackedDevices?.[deviceData?.serialNumber] === undefined && deviceData?.excluded === false) {
        if (deviceData.device_type === TeslaPowerwallAccfactory.DeviceType.POWERWALL) {
          // Tesla Powerwall - Categories.OUTLET = 7
          let tempDevice = new Powerwall(this.cachedAccessories, this.api, this.log, deviceData);
          tempDevice.add('Tesla Powerwall', 7, true);

          // Track this device once created
          this.#trackedDevices[deviceData.serialNumber] = {
            uuid: tempDevice.uuid,
            timers: undefined,
            exclude: false,
          };
        }

        if (deviceData.device_type === TeslaPowerwallAccfactory.DeviceType.GATEWAY) {
          // Tesla Gateway - Categories.OUTLET = 7
          /*
          let tempDevice = new Gateway(this.cachedAccessories, this.api, this.log, deviceData);
          tempDevice.add('Tesla Gateway', 7, true);

          // Track this device once created
          this.#trackedDevices[deviceData.serialNumber] = {
            uuid: tempDevice.uuid,
            timers: undefined,
            exclude: false,
          };
          */
        }
      }

      // Finally, if device is not excluded, send updated data to device for it to process
      if (deviceData.excluded === false && this.#trackedDevices?.[deviceData?.serialNumber] !== undefined) {
        if (this.#trackedDevices?.[deviceData?.serialNumber]?.uuid !== undefined) {
          HomeKitDevice.message(this.#trackedDevices[deviceData.serialNumber].uuid, HomeKitDevice.UPDATE, deviceData);
        }
      }
    });
  }

  #processData(deviceUUID) {
    if (typeof deviceUUID !== 'string') {
      deviceUUID = '';
    }

    let devices = {};

    Object.values(this.#rawData).forEach((data) => {
      // process raw device data
      let tempDevice = {};
      let din = data.gateway.din;
      let prefix = din.substring(0, 7);

      tempDevice.serialNumber = din.substring(din.indexOf('--') + 2).toUpperCase();
      tempDevice.excluded = this.config?.devices?.[tempDevice.serialNumber]?.exclude === true; // Mark device as excluded or not
      tempDevice.device_type = TeslaPowerwallAccfactory.DeviceType.GATEWAY;
      tempDevice.softwareVersion = data.gateway.version.replace(/-/g, '.').split(' ')[0];
      tempDevice.model = 'Gateway';

      if (prefix === '1099752') {
        tempDevice.model = 'Non-Backup Gateway';
      }
      if (prefix === '1118431') {
        tempDevice.model = 'Backup Gateway 1';
      }
      if (prefix === '1152100' || prefix === '1232100') {
        tempDevice.model = 'Backup Gateway 2';
      }
      if (prefix === '1841000') {
        tempDevice.model = 'Backup Gateway 3';
      }

      tempDevice.description = HomeKitDevice.makeValidHKName('Tesla ' + tempDevice.model);
      tempDevice.manufacturer = 'Tesla';
      tempDevice.powerflow = data.powerflow; // How power is flowing
      tempDevice.backup_reserve_percent = data.operation.backup_reserve_percent;
      tempDevice.nominal_energy_remaining = data.status.nominal_energy_remaining; // Should be battery remaing across all powerwalls
      tempDevice.nominal_full_pack_energy = data.status.nominal_full_pack_energy; // Should be battery capacity across all powerwalls
      tempDevice.online = false; // Offline by default

      Object.values(data.networks).forEach((network) => {
        if (network.enabled === true && network.active === true) {
          // Found a network interface that is marked as enabled and active, this means online status is true
          tempDevice.online = true;
        }
      });

      tempDevice.eveHistory =
        this.config.options.eveHistory === true || this.config?.devices?.[tempDevice.serialNumber]?.eveHistory === true;

      let gatewaySoftwareVersion = tempDevice.softwareVersion;
      devices[tempDevice.serialNumber] = tempDevice; // Store processed device

      // Process powerwalls attached to this gateway
      Object.values(data.status.battery_blocks).forEach((powerwall) => {
        let tempDevice = {};
        let partNumber = powerwall.PackagePartNumber.substring(0, 7);

        tempDevice.excluded = false;
        tempDevice.serialNumber = powerwall.PackageSerialNumber.toUpperCase(); // ensure serial numbers are in upper case
        tempDevice.device_type = TeslaPowerwallAccfactory.DeviceType.POWERWALL;
        tempDevice.softwareVersion = gatewaySoftwareVersion;
        tempDevice.model = 'Powerwall';

        if (partNumber === '1092170' || partNumber === '2012170' || partNumber === '3012170') {
          tempDevice.model = 'Powerwall 2 AC';
        }
        if (partNumber === '1112170') {
          tempDevice.model = 'Powerwall 2 DC';
        }
        if (partNumber === '1707000') {
          tempDevice.model = 'Powerwall 3';
        }

        tempDevice.description = HomeKitDevice.makeValidHKName('Tesla ' + tempDevice.model);
        tempDevice.manufacturer = 'Tesla';
        tempDevice.online = powerwall.OpSeqState.toUpperCase() === 'ACTIVE';
        tempDevice.backup_reserve_percent = data.operation.backup_reserve_percent;
        tempDevice.nominal_energy_remaining = powerwall.nominal_energy_remaining;
        tempDevice.nominal_full_pack_energy = powerwall.nominal_full_pack_energy;
        tempDevice.p_out = powerwall.p_out; // watts coming from battery. negative number means power flowing to battery
        tempDevice.v_out = powerwall.v_out; // volts coming from battery. negative number means power flowing to battery
        tempDevice.i_out = powerwall.i_out * -1; // amps coming from battery. negative number means power flowing to battery. need to invert

        tempDevice.eveHistory =
          this.config.options.eveHistory === true || this.config?.devices?.[tempDevice.serialNumber]?.eveHistory === true;

        devices[tempDevice.serialNumber] = tempDevice; // Store processed device
      });
    });

    return devices;
  }
}

// General helper functions which don't need to be part of an object class
function scaleValue(value, sourceMin, sourceMax, targetMin, targetMax) {
  if (sourceMax === sourceMin) {
    return targetMin;
  }

  value = Math.max(sourceMin, Math.min(sourceMax, value));

  return ((value - sourceMin) * (targetMax - targetMin)) / (sourceMax - sourceMin) + targetMin;
}

async function fetchWrapper(method, url, options, data) {
  if ((method !== 'get' && method !== 'post') || typeof url !== 'string' || url === '' || typeof options !== 'object') {
    return;
  }

  if (isNaN(options?.timeout) === false && Number(options.timeout) > 0) {
    // eslint-disable-next-line no-undef
    options.signal = AbortSignal.timeout(Number(options.timeout));
  }

  if (isNaN(options.retry) === true || options.retry < 1) {
    options.retry = 1;
  }

  if (isNaN(options._retryCount) === true) {
    options._retryCount = 0;
  }

  options.method = method;

  if (method === 'post' && data !== undefined) {
    options.body = data;
  }

  let response;
  try {
    // eslint-disable-next-line no-undef
    response = await fetch(url, options);
  } catch (error) {
    if (options.retry > 1) {
      options.retry--;
      options._retryCount++;

      const delay = 500 * 2 ** (options._retryCount - 1);
      await new Promise((resolve) => setTimeout(resolve, delay));

      return fetchWrapper(method, url, options, data);
    }

    error.message = `Fetch failed for ${method.toUpperCase()} ${url} after ${options._retryCount + 1} attempt(s): ${error.message}`;
    throw error;
  }

  if (response?.ok === false) {
    if (options.retry > 1) {
      options.retry--;
      options._retryCount++;

      let delay = 500 * 2 ** (options._retryCount - 1);
      await new Promise((resolve) => setTimeout(resolve, delay));

      return fetchWrapper(method, url, options, data);
    }

    let error = new Error(`HTTP ${response.status} on ${method.toUpperCase()} ${url}: ${response.statusText || 'Unknown error'}`);
    error.code = response.status;
    throw error;
  }

  return response;
}

// Startup code
export default (api) => {
  setGlobalDispatcher(
    new Agent({
      connect: {
        rejectUnauthorized: false,
      },
    }),
  );

  // Register our platform with Homebridge
  api.registerPlatform(HomeKitDevice.PLATFORM_NAME, TeslaPowerwallAccfactory);
};
