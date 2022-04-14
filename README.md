# launchpeg

## Commands
```
yarn # install dependencies
yarn prettier # format code
yarn test # run test
```

## Deploy LaunchPeg contract

Create a config file in ./tasks/config (see example.json), then run:

```
yarn compile
yarn deploy-launchpeg-fuji --config-filename <config-filename>
```