import { ScrollView, StyleSheet, Text } from 'react-native';
import { getCapabilities } from '@dynlabs/react-native-bluetooth-classic';

export default function App() {
  const capabilities = getCapabilities();

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>@dynlabs/react-native-bluetooth-classic</Text>
      <Text selectable>{JSON.stringify(capabilities, null, 2)}</Text>
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
});
