import { StyleSheet } from 'react-native';
import { isBluetoothClassicError } from '@dynlabs/react-native-bluetooth-classic';

/** A readable form of anything an API call threw. */
export function describeError(error: unknown): unknown {
  return isBluetoothClassicError(error) ? error.toJSON() : String(error);
}

export const styles = StyleSheet.create({
  heading: {
    fontWeight: '600',
    marginTop: 12,
  },
  code: {
    fontFamily: 'Courier',
    fontSize: 12,
  },
  buttons: {
    gap: 8,
    marginTop: 16,
  },
  row: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingVertical: 8,
  },
  input: {
    borderWidth: StyleSheet.hairlineWidth,
    fontFamily: 'Courier',
    marginTop: 8,
    padding: 8,
  },
});
