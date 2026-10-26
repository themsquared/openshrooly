import { SafeAreaView, ScrollView, Text, View } from "react-native";
import { tokens } from "./src/theme/tokens";

const screens = [
  "Fleet — chambers from the local hub",
  "Live status — humidity / temp / CO₂ gauges",
  "Apply profile — pull from Shroom Labs, apply on LAN",
  "Browse / purchase — culinary catalog + stub checkout",
  "Grow journal — photos, later push notifications",
];

export default function App() {
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: tokens.bg }}>
      <ScrollView contentContainerStyle={{ padding: tokens.space[3] }}>
        <Text style={{ color: tokens.mycelium, letterSpacing: 2, marginBottom: 8 }}>SHROOM LABS</Text>
        <Text style={{ color: tokens.ink, fontSize: 32, fontWeight: "700" }}>iOS scaffold</Text>
        <Text style={{ color: tokens.muted, marginTop: 8, marginBottom: 24 }}>
          Expo app planned against api.shroomlabs.io and the local hub. Same design tokens. No App Store submission in this pass.
        </Text>
        {screens.map((line) => (
          <View
            key={line}
            style={{
              borderColor: tokens.line,
              borderWidth: 1,
              borderRadius: tokens.radiusSm,
              padding: tokens.space[2],
              marginBottom: tokens.space[2],
              backgroundColor: tokens.bgElev,
            }}
          >
            <Text style={{ color: tokens.ink }}>{line}</Text>
          </View>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}
