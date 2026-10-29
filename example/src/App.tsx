import { useState } from 'react';
import { Button, ScrollView, StyleSheet, Text, View } from 'react-native';
import { DiscoveryScreen } from './screens/DiscoveryScreen';
import { OverviewScreen } from './screens/OverviewScreen';
import { PairingScreen } from './screens/PairingScreen';

const SCREENS = {
  Overview: OverviewScreen,
  Discovery: DiscoveryScreen,
  Pairing: PairingScreen,
};

type ScreenName = keyof typeof SCREENS;

export default function App() {
  const [screen, setScreen] = useState<ScreenName>('Overview');
  const Screen = SCREENS[screen];

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>@dynlabs/react-native-bluetooth-classic</Text>
      <View style={styles.tabs}>
        {(Object.keys(SCREENS) as ScreenName[]).map((name) => (
          <Button
            key={name}
            title={name}
            disabled={name === screen}
            onPress={() => setScreen(name)}
          />
        ))}
      </View>
      <Screen />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 24,
    paddingTop: 64,
  },
  title: {
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 12,
  },
  tabs: {
    flexDirection: 'row',
    gap: 8,
  },
});
