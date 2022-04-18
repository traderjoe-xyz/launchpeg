# launchpeg

## Commands
```
yarn # install dependencies
yarn prettier # format code
yarn test # run test
```

## Deploy contracts

Create a config file in ./tasks/config (see example.json), then run:

```
yarn compile
yarn deploy-launchpeg-fuji --config-filename <config-filename>
yarn verify-launchpeg-fuji --contract-address <contract-address> --config-filename <config-filename>
yarn deploy-flat-launchpeg-fuji --config-filename <config-filename>
yarn verify-flat-launchpeg-fuji --contract-address <contract-address> --config-filename <config-filename>
```