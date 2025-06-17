# Change Log

All notable changes to `homebridge-teslapowerwall-accfactory` will be documented in this file. This project tries to adhere to [Semantic Versioning](http://semver.org/).

## Known issues

- Entered passwords for gateway(s) are stored in plain text in configuration JSON.

## v0.1.0 (2025/06/18)

- Refactored to use new HomeKitDevice base class
- Minor internal improvements

## v0.0.9 (2025/06/14) 

- Dependency updates
- Minor improvements and stability fixes

## v0.0.8 (2024/12/19) 

- Minor fixes and dependency updates

## v0.0.7 (2024/12/08) 

- Minor fixes and dependency updates

## v0.0.5 (2024/10/12) 

- Safer way to handle the way Tesla uses unsigned certificates. No longer set NODE_TLS_REJECT_UNAUTHORIZED to 0 in the process that starts the code

## v0.0.4 (2024/10/10)

- Added plugin configuration via Homebridge-config-ui GUI

## v0.0.2 (2024/10/08)

- Fix for devices not updating

## v0.0.1 (2024/10/07)

- Initial version from my internal home project, TelsaPowerwall_accfactory