import { useState } from 'react';
import {
  Button,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { AccessoriesScreen } from './screens/AccessoriesScreen';
import { BenchmarkScreen } from './screens/BenchmarkScreen';
import { ConnectScreen } from './screens/ConnectScreen';
import { DiscoveryScreen } from './screens/DiscoveryScreen';
import { EchoScreen } from './screens/EchoScreen';
import { OverviewScreen } from './screens/OverviewScreen';
import { PairingScreen } from './screens/PairingScreen';

const ANDROID_SCREENS = {
  Overview: OverviewScreen,
  Discovery: DiscoveryScreen,
  Pairing: PairingScreen,
  Connect: ConnectScreen,
  Echo: EchoScreen,
  Benchmark: BenchmarkScreen,
};

// iOS has no discovery or pairing: MFi accessories come from the picker.
const IOS_SCREENS = {
  Overview: OverviewScreen,
  Accessories: AccessoriesScreen,
  Echo: EchoScreen,
  Benchmark: BenchmarkScreen,
};

const SCREENS: Record<string, React.ComponentType> =
  Platform.OS === 'ios' ? IOS_SCREENS : ANDROID_SCREENS;

export default function App() {
  const [screen, setScreen] = useState('Overview');
  const Screen = SCREENS[screen] ?? OverviewScreen;

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>@dynlabs/react-native-bluetooth-classic</Text>
      <View style={styles.tabs}>
        {Object.keys(SCREENS).map((name) => (
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
    flexWrap: 'wrap',
    gap: 8,
  },
});
