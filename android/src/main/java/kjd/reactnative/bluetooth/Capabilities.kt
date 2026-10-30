package kjd.reactnative.bluetooth

import android.os.Build

/** Android features that only report `true` once their implementation has landed. */
internal enum class Feature {
  DISCOVERY,
  PAIRING,
  SERVER
}

/** Builds the `getCapabilities()` result. The flags must match what the module actually does. */
internal object Capabilities {
  val LANDED: Set<Feature> = setOf(Feature.DISCOVERY, Feature.PAIRING, Feature.SERVER)

  /** First API level whose OS reports that a remote device lost its bond keys. */
  const val BOND_LOSS_MIN_SDK = 36

  fun android(sdkInt: Int = Build.VERSION.SDK_INT, landed: Set<Feature> = LANDED): Map<String, Any> =
    mapOf(
      "platform" to "android",
      "osVersion" to sdkInt.toString(),
      "discovery" to (Feature.DISCOVERY in landed),
      "pairing" to (Feature.PAIRING in landed),
      "server" to (Feature.SERVER in landed),
      "adapterState" to true,
      "requestEnable" to true,
      // Bond-loss events come from the bond receivers that ship with pairing.
      "bondLossEvents" to (Feature.PAIRING in landed && sdkInt >= BOND_LOSS_MIN_SDK),
      "accessoryPicker" to false,
      "declaredProtocols" to emptyList<String>()
    )
}
