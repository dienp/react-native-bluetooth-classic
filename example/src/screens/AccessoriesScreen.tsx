import { useEffect, useState } from 'react';
import { Button, Text, TextInput, View } from 'react-native';
import {
  connect,
  getConnectedAccessories,
  onAccessoryConnected,
  onAccessoryDisconnected,
  showAccessoryPicker,
  type IosAccessory,
} from '@dynlabs/react-native-bluetooth-classic';
import { describeError, styles } from '../styles';

/**
 * iOS: shows the accessory picker, lists connected MFi accessories with a
 * declared protocol, and opens a session with one of them.
 */
export function AccessoriesScreen() {
  const [accessories, setAccessories] = useState<readonly IosAccessory[]>([]);
  const [nameFilter, setNameFilter] = useState('');
  const [log, setLog] = useState<string[]>([]);

  const append = (line: string) => setLog((previous) => [line, ...previous]);

  const refresh = async () => setAccessories(await getConnectedAccessories());

  const attempt = (action: () => Promise<void>) => () => {
    action().catch((error) =>
      append(`Failed: ${JSON.stringify(describeError(error))}`)
    );
  };

  useEffect(() => {
    const subscriptions = [
      onAccessoryConnected(({ accessory }) => {
        append(`Accessory connected: ${accessory.name} (${accessory.id})`);
        refresh().catch(() => {});
      }),
      onAccessoryDisconnected(({ accessory }) => {
        append(`Accessory disconnected: ${accessory.name} (${accessory.id})`);
        refresh().catch(() => {});
      }),
    ];
    refresh().catch((error) =>
      append(`Failed: ${JSON.stringify(describeError(error))}`)
    );
    return () => subscriptions.forEach((subscription) => subscription.remove());
  }, []);

  return (
    <View>
      <TextInput
        onChangeText={setNameFilter}
        placeholder="Name filter (optional)"
        style={styles.input}
        value={nameFilter}
      />
      <View style={styles.buttons}>
        <Button
          title="Show accessory picker"
          onPress={attempt(async () => {
            await showAccessoryPicker(
              nameFilter === '' ? undefined : { nameFilter }
            );
            append('Picker closed with a selection');
          })}
        />
        <Button title="Refresh accessories" onPress={attempt(refresh)} />
      </View>
      {accessories.map((accessory) => (
        <View key={accessory.id} style={styles.row}>
          <Text>{accessory.name}</Text>
          <Text style={styles.code}>
            {accessory.manufacturer} {accessory.modelNumber} ·{' '}
            {accessory.protocolStrings.join(', ')}
          </Text>
          <Button
            title={`Connect ${accessory.name}`}
            onPress={attempt(async () => {
              const connection = await connect(accessory.id);
              append(
                `Connected ${connection.id} with ${connection.protocol ?? '?'}`
              );
              connection.onDisconnected(({ reason, error }) =>
                append(
                  `${connection.id} ended: ${reason}${error ? ` (${error.code})` : ''}`
                )
              );
            })}
          />
        </View>
      ))}
      {log.map((line, index) => (
        <Text key={index} style={styles.code}>
          {line}
        </Text>
      ))}
    </View>
  );
}
