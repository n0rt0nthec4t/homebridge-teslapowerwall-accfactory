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
// Code version 10/10/2024
// Mark Hulskamp
'use strict';

// Define nodejs module requirements
import EventEmitter from 'node:events';
import { setInterval, clearInterval, setTimeout, clearTimeout } from 'node:timers';
import crypto from 'node:crypto';
import { Agent, setGlobalDispatcher } from 'undici';

// Import our modules
import HomeKitDevice from './HomeKitDevice.js';
HomeKitDevice.PLUGIN_NAME = 'homebridge-teslapowerwall-accfactory';
HomeKitDevice.PLATFORM_NAME = 'TeslaPowerwallAccfactory';

import HomeKitHistory from './HomeKitHistory.js';
HomeKitDevice.HISTORY = HomeKitHistory;

// Powerwall class
const MINWATTS = 100;

class Powerwall extends HomeKitDevice {
  batteryService = undefined;
  outletService = undefined;

  constructor(accessory, api, log, eventEmitter, deviceData) {
    super(accessory, api, log, eventEmitter, deviceData);
  }

  // Class functions
  addServices() {
    // Setup the outlet service if not already present on the accessory
    this.outletService = this.accessory.getService(this.hap.Service.Outlet);
    if (this.outletService === undefined) {
      this.outletService = this.accessory.addService(this.hap.Service.Outlet, '', 1);
    }
    if (this.outletService.testCharacteristic(this.hap.Characteristic.StatusFault) === false) {
      this.outletService.addCharacteristic(this.hap.Characteristic.StatusFault);
    }
    this.outletService.setPrimaryService();

    // Setup the battery service if not already present on the accessory
    this.batteryService = this.accessory.getService(this.hap.Service.Battery);
    if (this.batteryService === undefined) {
      this.batteryService = this.accessory.addService(this.hap.Service.Battery, '', 1);
    }
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

  updateServices(deviceData) {
    if (typeof deviceData !== 'object' || this.outletService === undefined || this.batteryService === undefined) {
      return;
    }

    // If device isn't online report in HomeKit
    this.outletService.updateCharacteristic(
      this.hap.Characteristic.StatusFault,
      deviceData.online === true ? this.hap.Characteristic.StatusFault.NO_FAULT : this.hap.Characteristic.StatusFault.GENERAL_FAULT,
    );

    // Update energy flows
    this.outletService.updateCharacteristic(this.hap.Characteristic.On, deviceData.p_out > MINWATTS ? true : false);
    this.outletService.updateCharacteristic(this.hap.Characteristic.OutletInUse, deviceData.p_out > MINWATTS ? true : false);

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
          status: deviceData.p_out > MINWATTS ? 1 : 0,
          volts: deviceData.p_out > MINWATTS && deviceData.v_out > MINWATTS ? deviceData.v_out : 0,
          watts: deviceData.p_out > MINWATTS ? deviceData.p_out : 0,
          amps: deviceData.p_out > MINWATTS && deviceData.i_out > 0 ? deviceData.i_out : 0,
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
  batteryService = undefined;
  outletService = undefined;

  constructor(accessory, api, log, eventEmitter, deviceData) {
    super(accessory, api, log, eventEmitter, deviceData);
  }

  // Class functions
  addServices() {
    // Setup the outlet service if not already present on the accessory
    this.outletService = this.accessory.getService(this.hap.Service.Outlet);
    if (this.outletService === undefined) {
      this.outletService = this.accessory.addService(this.hap.Service.Outlet, '', 1);
    }
    if (this.outletService.testCharacteristic(this.hap.Characteristic.StatusFault) === false) {
      this.outletService.addCharacteristic(this.hap.Characteristic.StatusFault);
    }
    if (this.outletService.testCharacteristic(this.hap.Characteristic.CurrentAmbientLightLevel) === false) {
      this.outletService.addCharacteristic(this.hap.Characteristic.CurrentAmbientLightLevel);
    }
    this.outletService.setPrimaryService();

    // Below doesnt appear to change anything in HomeKit, but we'll do it anyway. maybe for future
    this.outletService.getCharacteristic(this.hap.Characteristic.CurrentAmbientLightLevel).displayName = 'Solar Generation';
    this.outletService.getCharacteristic(this.hap.Characteristic.BatteryLevel).displayName = 'Solar Generation';
    this.outletService.getCharacteristic(this.hap.Characteristic.ChargingState).displayName = 'Exporting';

    // Setup the battery service if not already present on the accessory
    this.batteryService = this.accessory.getService(this.hap.Service.Battery);
    if (this.batteryService === undefined) {
      this.batteryService = this.accessory.addService(this.hap.Service.Battery, '', 1);
    }
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

  updateServices(deviceData) {
    if (typeof deviceData !== 'object' || this.outletService === undefined || this.batteryService === undefined) {
      return;
    }

    // If device isn't online report in HomeKit
    this.outletService.updateCharacteristic(
      this.hap.Characteristic.StatusFault,
      deviceData.online === true ? this.hap.Characteristic.StatusFault.NO_FAULT : this.hap.Characteristic.StatusFault.GENERAL_FAULT,
    );

    if (deviceData.powerflow.battery && deviceData.powerflow.battery.instant_power >= 100) {
      // Over "minwatts" coming from battery, we assume using battery power to either house or grid
      // Using this as metric seems to smooth out the small discharges seen from app
      this.batteryService
        .getCharacteristic(this.hap.Characteristic.ChargingState)
        .updateValue(this.hap.Characteristic.ChargingState.NOT_CHARGING);
      this.outletService.getCharacteristic(this.hap.Characteristic.On).updateValue(true);
    } else if (
      deviceData.powerflow.battery &&
      deviceData.powerflow.battery.instant_power > 0 &&
      deviceData.powerflow.battery.instant_power < 100
    ) {
      this.batteryService
        .getCharacteristic(this.hap.Characteristic.ChargingState)
        .updateValue(this.hap.Characteristic.ChargingState.NOT_CHARGING);
      this.outletService.getCharacteristic(this.hap.Characteristic.On).updateValue(false);
    } else if (deviceData.powerflow.battery && deviceData.powerflow.battery.instant_power <= 0) {
      if (scaleValue(deviceData.nominal_energy_remaining, 0, deviceData.nominal_full_pack_energy, 0, 100) < 100) {
        // Power going to battery and charged battery percentage is less than 100%
        this.batteryService
          .getCharacteristic(this.hap.Characteristic.ChargingState)
          .updateValue(this.hap.Characteristic.ChargingState.CHARGING);
      } else {
        // Battery is at 100%, so not charging
        this.batteryService
          .getCharacteristic(this.hap.Characteristic.ChargingState)
          .updateValue(this.hap.Characteristic.ChargingState.NOT_CHARGING);
      }
      this.outletService.getCharacteristic(this.hap.Characteristic.On).updateValue(false);
    }

    this.batteryService.updateCharacteristic(
      this.hap.Characteristic.StatusLowBattery,
      scaleValue(deviceData.nominal_energy_remaining, 0, deviceData.nominal_full_pack_energy, 0, 100) < deviceData.backup_reserve_percent
        ? this.hap.Characteristic.StatusLowBattery.BATTERY_LEVEL_LOW
        : this.hap.Characteristic.StatusLowBattery.BATTERY_LEVEL_NORMAL,
    );

    // Solar generation in watts as a LUX reading
    this.outletService
      .getCharacteristic(this.hap.Characteristic.CurrentAmbientLightLevel)
      .updateValue(
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
const SUBSCRIBEINTERVAL = 15000; // Get system details every 2 seconds

class TeslaPowerwallAccfactory {
  static DeviceType = {
    GATEWAY: 'gateway',
    POWERWALL: 'powerwall',
  };

  cachedAccessories = []; // Track restored cached accessories

  // Internal data only for this class
  #connections = {}; // Object of confirmed connections
  #rawData = {}; // Cached copy of data from Rest API
  #eventEmitter = new EventEmitter(); // Used for object messaging from this platform
  #connectionTimer = undefined;
  #trackedDevices = {}; // Object of devices we've created. used to track comms uuid. key'd by serial #

  constructor(log, config, api) {
    this.config = config;
    this.log = log;
    this.api = api;

    // Perform validation on the configuration passed into us and set defaults if not present

    // Build our connection object. Allows us to have multiple diffent account connections under the one accessory
    if (config?.gateways !== undefined && Array.isArray(config.gateways) === true) {
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

    if (this.api instanceof EventEmitter === true) {
      this.api.on('didFinishLaunching', async () => {
        // We got notified that Homebridge has finished loading, so we are ready to process
        this.discoverDevices();

        // We'll check connection status every 15 seconds. We'll also handle token expiry/refresh this way
        clearInterval(this.#connectionTimer);
        this.#connectionTimer = setInterval(this.discoverDevices.bind(this), 15000);
      });

      this.api.on('shutdown', async () => {
        // We got notified that Homebridge is shutting down
        // Perform cleanup some internal cleaning up
        this.#eventEmitter.removeAllListeners();
        this.#rawData = {};
        this.#eventEmitter = undefined;
      });
    }
  }

  configureAccessory(accessory) {
    // This gets called from HomeBridge each time it restores an accessory from its cache
    this?.log?.info && this.log.info('Loading accessory from cache:', accessory.displayName);

    // add the restored accessory to the accessories cache, so we can track if it has already been registered
    this.cachedAccessories.push(accessory);
  }

  async discoverDevices() {
    Object.keys(this.#connections).forEach((uuid) => {
      if (this.#connections[uuid]?.authorised === false && this.#connections[uuid]?.retry === true) {
        this.#connect(uuid).then(() => {
          if (this.#connections[uuid].authorised === true) {
            this.#subscribeREST(uuid);
          }
        });
      }
    });
  }

  async #connect(connectionUUID) {
    if (typeof this.#connections?.[connectionUUID] === 'object') {
      this?.log?.info && this.log.info('Performing authorisation to Tesla Gateway at "%s"', this.#connections[connectionUUID].gateway);

      await fetchWrapper(
        'post',
        'https://' + this.#connections[connectionUUID].gateway + '/api/login/Basic',
        {},
        JSON.stringify({
          username: this.#connections[connectionUUID].username,
          password: this.#connections[connectionUUID].password,
          email: this.#connections[connectionUUID].email,
        }),
      )
        .then((response) => response.json())
        .then((data) => {
          this.#connections[connectionUUID].authorised = true;
          this.#connections[connectionUUID].token = data.token;

          // Set timeout for token expiry refresh
          clearTimeout(this.#connections[connectionUUID].timer);
          this.#connections[connectionUUID].timer = setTimeout(
            () => {
              this?.log?.info &&
                this.log.info('Performing periodic re-authorisation to Tesla Gateway "%s"', this.#connections[connectionUUID].gateway);
              this.#connect(connectionUUID);
            },
            1000 * 3600 * 24,
          ); // Refresh token every 24hrs

          this?.log?.success &&
            this.log.success('Successfully authorised to Telsa Gateway "%s"', this.#connections[connectionUUID].gateway);
        })
        .catch((error) => {
          this.#connections[connectionUUID].authorised = false;
          if (error?.cause?.code === 'ENOTFOUND') {
            this?.log?.error &&
              this.log.error(
                'Specified Tesla gateway "%s" could not be found. Please check your configuration',
                this.#connections[connectionUUID].gateway,
              );
            this.#connections[connectionUUID].retry = false;
            return;
          }
          if (error?.cause?.code !== undefined && error.cause.code.includes('TIMEOUT') === true) {
            this?.log?.error &&
              this.log.error(
                'Failed to connect to Tesla Gateway "%s". A periodic retry event will be triggered',
                this.#connections[connectionUUID].gateway,
              );
            this.#connections[connectionUUID].retry = true;
            return;
          }

          this?.log?.error &&
            this.log.error(
              'Authorisation failed to Tesla Gateway "%s". A periodic retry event will be triggered',
              this.#connections[connectionUUID].gateway,
            );
          this.#connections[connectionUUID].retry = true;
          return;
        });
    }
  }

  async #subscribeREST(connectionUUID) {
    if (typeof this.#connections?.[connectionUUID] !== 'object' || this.#connections?.[connectionUUID]?.authorised !== true) {
      // Not a valid connection object and/or we're not authorised
      return;
    }

    const FETCHURLS = [
      '/api/networks',
      '/api/status',
      '/api/powerwalls',
      '/api/meters/aggregates',
      '/api/system_status',
      '/api/operation',
      '/api/solars',
    ];

    let tempObject = [];
    await Promise.all(
      FETCHURLS.map(async (url) => {
        await fetchWrapper('get', 'https://' + this.#connections[connectionUUID].gateway + url, {
          headers: {
            'content-type': 'application/json',
            cookie: 'AuthCookie=' + this.#connections[connectionUUID].token,
          },
        })
          .then((response) => response.json())
          .then((data) => {
            tempObject[url] = data;
          })
          .catch((error) => {
            if (error?.cause !== undefined && JSON.stringify(error.cause).toUpperCase().includes('TIMEOUT') === false && this?.log?.debug) {
              this.log.debug('REST API had an error obtaining data from url "%s" for uuid "%s"', url, connectionUUID);
              this.log.debug('Error was "%s"', error);
            }
          });
      }),
    );

    if (Object.keys(tempObject).length === FETCHURLS.length) {
      // We got all the data required, so now can process what we retrieved
      this.#rawData[connectionUUID] = {
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

    // redo data gathering again after specified timeout
    setTimeout(this.#subscribeREST.bind(this, connectionUUID), SUBSCRIBEINTERVAL);
  }

  #processPostSubscribe() {
    Object.values(this.#processData('')).forEach((deviceData) => {
      if (this.#trackedDevices?.[deviceData?.serialNumber] === undefined && deviceData?.excluded === true) {
        // We haven't tracked this device before (ie: should be a new one) and but its excluded
        this?.log?.warn && this.log.warn('Device "%s" is ignored due to it being marked as excluded', deviceData.description);
      }
      if (this.#trackedDevices?.[deviceData?.serialNumber] === undefined && deviceData?.excluded === false) {
        if (deviceData.device_type === TeslaPowerwallAccfactory.DeviceType.POWERWALL) {
          // Tesla Powerwall - Categories.OUTLET = 7
          let tempDevice = new Powerwall(this.cachedAccessories, this.api, this.log, this.#eventEmitter, deviceData);
          tempDevice.add('Tesla Powerwall', 7, true);

          // Track this device once created
          this.#trackedDevices[deviceData.serialNumber] = {
            uuid: tempDevice.uuid,
          };
        }

        if (deviceData.device_type === TeslaPowerwallAccfactory.DeviceType.GATEWAY) {
          // Tesla Gateway - Categories.OUTLET = 7
          /* let tempDevice = new Gateway(this.cachedAccessories, this.api, this.log, this.#eventEmitter, deviceData);
          tempDevice.add('Tesla Gateway', 7, true);

          // Track this device once created
          this.#trackedDevices[deviceData.serialNumber] = {
            uuid: tempDevice.uuid,
          }; */
        }
      }

      // Finally, if device is not excluded, send updated data to device for it to process
      if (deviceData.excluded === false && this.#trackedDevices?.[deviceData?.serialNumber] !== undefined) {
        this.#eventEmitter.emit(this.#trackedDevices[deviceData.serialNumber].uuid, HomeKitDevice.UPDATE, deviceData);
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
      var tempDevice = {};
      tempDevice.serialNumber = data.gateway.din.substring(data.gateway.din.indexOf('--') + 2).toUpperCase();
      tempDevice.excluded = this.config?.devices?.[tempDevice?.serialNumber]?.exclude === true; // Mark device as excluded or not
      tempDevice.device_type = TeslaPowerwallAccfactory.DeviceType.GATEWAY;
      tempDevice.softwareVersion = data.gateway.version.replace(/-/g, '.').split(' ')[0];
      tempDevice.model = 'Gateway';
      if (data.gateway.din.substring(0, 7) === '1099752') {
        tempDevice.model = 'Non-Backup Gateway';
      }
      if (data.gateway.din.substring(0, 7) === '1118431') {
        tempDevice.model = 'Backup Gateway 1';
      }
      if (data.gateway.din.substring(0, 7) === '1152100' || data.gateway.din.substring(0, 7) === '1232100') {
        tempDevice.model = 'Backup Gateway 2';
      }
      if (data.gateway.din.substring(0, 7) === '1841000') {
        tempDevice.model = 'Backup Gateway 3';
      }
      tempDevice.description = makeHomeKitName('Tesla ' + tempDevice.model);
      tempDevice.manufacturer = 'Tesla';
      tempDevice.powerflow = data.powerflow; // How power is flowing
      tempDevice.backup_reserve_percent = data.operation.backup_reserve_percent;
      tempDevice.nominal_energy_remaining = data.status.nominal_energy_remaining; // Should be battery remaing across all powerwalls
      tempDevice.nominal_full_pack_energy = data.status.nominal_full_pack_energy; // Should be battery capacity across all powerwalls
      tempDevice.online = false; // Offline by default
      data.networks.forEach((network) => {
        if (network.enabled === true && network.active === true) {
          // Found a network interface that is marked as enabled and active, this means online status is true
          tempDevice.online = true;
        }
      });
      tempDevice.eveHistory =
        this.config.options.eveHistory === true || this.config?.devices?.[tempDevice.serialNumber]?.eveHistory === true;

      let gatewaySoftwareVersion = tempDevice.softwareVersion;
      devices[tempDevice.serialNumber] = tempDevice; // Store processed device

      // Proccess powerwalls attached to this gateway
      Object.values(data.status.battery_blocks).forEach((powerwall) => {
        var tempDevice = {};
        tempDevice.excluded = false;
        tempDevice.serialNumber = powerwall.PackageSerialNumber.toUpperCase(); // ensure serial numbers are in upper case
        tempDevice.device_type = TeslaPowerwallAccfactory.DeviceType.POWERWALL;
        tempDevice.softwareVersion = gatewaySoftwareVersion;
        //tempDevice.softwareVersion = powerwall.version.replace(/-/g, '.');
        tempDevice.model = 'Powerwall';
        if (
          powerwall.PackagePartNumber.substring(0, 7) === '1092170' ||
          powerwall.PackagePartNumber.substring(0, 7) === '2012170' ||
          powerwall.PackagePartNumber.substring(0, 7) === '3012170'
        ) {
          tempDevice.model = 'Powerwall 2 AC';
        }
        if (powerwall.PackagePartNumber.substring(0, 7) === '1112170') {
          tempDevice.model = 'Powerwall 2 DC';
        }
        if (powerwall.PackagePartNumber.substring(0, 7) === '1707000') {
          tempDevice.model = 'Powerwall 3';
        }
        tempDevice.description = makeHomeKitName('Tesla ' + tempDevice.model);
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
function makeHomeKitName(nameToMakeValid) {
  // Strip invalid characters to meet HomeKit naming requirements
  // Ensure only letters or numbers are at the beginning AND/OR end of string
  // Matches against uni-code characters
  return typeof nameToMakeValid === 'string'
    ? nameToMakeValid
        .replace(/[^\p{L}\p{N}\p{Z}\u2019.,-]/gu, '')
        .replace(/^[^\p{L}\p{N}]*/gu, '')
        .replace(/[^\p{L}\p{N}]+$/gu, '')
    : nameToMakeValid;
}

function scaleValue(value, sourceRangeMin, sourceRangeMax, targetRangeMin, targetRangeMax) {
  if (value < sourceRangeMin) {
    value = sourceRangeMin;
  }
  if (value > sourceRangeMax) {
    value = sourceRangeMax;
  }
  return ((value - sourceRangeMin) * (targetRangeMax - targetRangeMin)) / (sourceRangeMax - sourceRangeMin) + targetRangeMin;
}

async function fetchWrapper(method, url, options, data, response) {
  if ((method !== 'get' && method !== 'post') || typeof url !== 'string' || url === '' || typeof options !== 'object') {
    return;
  }

  if (isNaN(options?.timeout) === false && Number(options?.timeout) > 0) {
    // If a timeout is specified in the options, setup here
    // eslint-disable-next-line no-undef
    options.signal = AbortSignal.timeout(Number(options.timeout));
  }

  if (options?.retry === undefined) {
    // If not retry option specifed , we'll do just once
    options.retry = 1;
  }

  options.method = method; // Set the HTTP method to use

  if (method === 'post' && typeof data !== undefined) {
    // Doing a HTTP post, so include the data in the body
    options.body = data;
  }

  if (options.retry > 0) {
    // eslint-disable-next-line no-undef
    response = await fetch(url, options);
    if (response.ok === false && options.retry > 1) {
      options.retry--; // One less retry to go

      // Try again after short delay (500ms)
      // We pass back in this response also for when we reach zero retries and still not successful
      await new Promise((resolve) => setTimeout(resolve, 500));
      // eslint-disable-next-line no-undef
      response = await fetchWrapper(method, url, options, data, structuredClone(response));
    }
    if (response.ok === false && options.retry === 0) {
      let error = new Error(response.statusText);
      error.code = response.status;
      throw error;
    }
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

  // Register our platform with HomeBridge
  api.registerPlatform(HomeKitDevice.PLATFORM_NAME, TeslaPowerwallAccfactory);
};
