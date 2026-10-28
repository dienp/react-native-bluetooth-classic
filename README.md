# react-native-bluetooth-classic

Bluetooth Classic serial (RFCOMM/SPP) on Android and MFi ExternalAccessory sessions on iOS, for React Native's new architecture.

> [!WARNING]
> **Version 2 is under active development** and is not ready for production use. The API is being rebuilt as a TurboModule, and the native implementations are still stubs.
>
> **v1** (`1.73.x`) is maintained on the [`1.x` branch](https://github.com/kenjdavidson/react-native-bluetooth-classic/tree/1.x). Use v1 if you need the legacy architecture, React Native below 0.82, or Windows.

## Support matrix (v2)

| | Minimum | Tested up to |
|---|---|---|
| React Native | 0.82 (new architecture only) | latest |
| Android | API 24 (Android 7.0) | API 37 (Android 17) |
| iOS | 15.1 | iOS 27 |
| Expo | Development builds only, through the bundled config plugin | — |

Windows, macOS, web, Expo Go and Bluetooth Low Energy are not supported.

## Install

```sh
yarn add react-native-bluetooth-classic
cd ios && pod install
```

Rebuild the app after installing. Expo apps need a development build (Expo Go is not supported); the bundled config plugin is planned (task group 8).

## Quick start

```ts
import {
  ErrorCode,
  getBondedDevices,
  getCapabilities,
  isBluetoothClassicError,
  requestEnable,
  requestPermissions,
} from 'react-native-bluetooth-classic';

if (getCapabilities().pairing) {
  await requestPermissions('connect');
  try {
    const devices = await getBondedDevices();
  } catch (error) {
    if (isBluetoothClassicError(error, ErrorCode.BLUETOOTH_DISABLED)) {
      await requestEnable();
    }
  }
}
```

Every failure is a `BluetoothClassicError` with a `code`; see [docs/errors.md](./docs/errors.md).

## Documentation

- [API reference](./docs/api.md)
- [Error codes](./docs/errors.md)
- [Migrating from v1](./docs/migration-v1-to-v2.md)

## Plan

The rework is specified with [OpenSpec](https://github.com/Fission-AI/OpenSpec) in [`openspec/changes/rework-v2-new-architecture`](./openspec/changes/rework-v2-new-architecture):

- [`proposal.md`](./openspec/changes/rework-v2-new-architecture/proposal.md): why v2 exists and what changes.
- [`specs/`](./openspec/changes/rework-v2-new-architecture/specs): the behavior contract for each capability.
- [`design.md`](./openspec/changes/rework-v2-new-architecture/design.md): architecture and decisions, including the v1 → v2 API mapping.
- [`tasks.md`](./openspec/changes/rework-v2-new-architecture/tasks.md): implementation progress.

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md).

## License

MIT
