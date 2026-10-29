package kjd.reactnative.bluetooth

import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.WritableArray
import com.facebook.react.bridge.WritableMap

/** Converts plain Kotlin values into the maps and arrays React Native sends to JS. */
internal object Writables {
  // The default maps are JNI-backed; JVM tests swap in JavaOnlyMap/JavaOnlyArray.
  @Volatile var createMap: () -> WritableMap = { Arguments.createMap() }
  @Volatile var createArray: () -> WritableArray = { Arguments.createArray() }

  fun map(values: Map<String, Any?>): WritableMap {
    val map = createMap()
    for ((key, value) in values) {
      when (value) {
        null -> map.putNull(key)
        is String -> map.putString(key, value)
        is Boolean -> map.putBoolean(key, value)
        is Int -> map.putInt(key, value)
        is Number -> map.putDouble(key, value.toDouble())
        is Map<*, *> -> map.putMap(key, map(value.entries.associate { it.key.toString() to it.value }))
        is List<*> -> map.putArray(key, array(value))
        else -> throw IllegalArgumentException("Cannot send ${value.javaClass.name} to JS")
      }
    }
    return map
  }

  fun array(values: List<*>): WritableArray {
    val array = createArray()
    for (value in values) {
      when (value) {
        null -> array.pushNull()
        is String -> array.pushString(value)
        is Boolean -> array.pushBoolean(value)
        is Int -> array.pushInt(value)
        is Number -> array.pushDouble(value.toDouble())
        is Map<*, *> -> array.pushMap(map(value.entries.associate { it.key.toString() to it.value }))
        is List<*> -> array.pushArray(array(value))
        else -> throw IllegalArgumentException("Cannot send ${value.javaClass.name} to JS")
      }
    }
    return array
  }
}
