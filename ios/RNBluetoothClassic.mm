#import "RNBluetoothClassic.h"
#import "RNBCErrorCode.h"

#import <UIKit/UIKit.h>

static NSString *const RNBCNotImplementedMessage =
    @"Not implemented yet in this react-native-bluetooth-classic v2 pre-release";

// Pre-release stub. Reports every capability as unavailable and rejects every
// operation with UNSUPPORTED_ON_PLATFORM until the iOS implementation (task
// group 7 of the rework-v2-new-architecture OpenSpec change) lands.
@implementation RNBluetoothClassic

static void RNBCRejectNotImplemented(RCTPromiseRejectBlock reject)
{
  reject(RNBCErrorCode_UNSUPPORTED_ON_PLATFORM, RNBCNotImplementedMessage, nil);
}

- (NSDictionary *)getCapabilities
{
  return @{
    @"platform" : @"ios",
    @"osVersion" : [[UIDevice currentDevice] systemVersion],
    @"discovery" : @NO,
    @"pairing" : @NO,
    @"server" : @NO,
    @"adapterState" : @NO,
    @"requestEnable" : @NO,
    @"bondLossEvents" : @NO,
    @"accessoryPicker" : @NO,
    @"declaredProtocols" : @[],
  };
}

- (void)setLogLevel:(NSString *)level
{
}

- (void)getAdapterState:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject
{
  RNBCRejectNotImplemented(reject);
}

- (void)requestEnable:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject
{
  RNBCRejectNotImplemented(reject);
}

- (void)openSettings:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject
{
  RNBCRejectNotImplemented(reject);
}

- (void)setAdapterName:(NSString *)name
               resolve:(RCTPromiseResolveBlock)resolve
                reject:(RCTPromiseRejectBlock)reject
{
  RNBCRejectNotImplemented(reject);
}

- (void)checkPermissions:(NSString *)scope
                 resolve:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject
{
  RNBCRejectNotImplemented(reject);
}

- (void)requestPermissions:(NSString *)scope
                   resolve:(RCTPromiseResolveBlock)resolve
                    reject:(RCTPromiseRejectBlock)reject
{
  RNBCRejectNotImplemented(reject);
}

- (void)getBondedDevices:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject
{
  RNBCRejectNotImplemented(reject);
}

- (void)startDiscovery:(double)timeoutMs
               resolve:(RCTPromiseResolveBlock)resolve
                reject:(RCTPromiseRejectBlock)reject
{
  RNBCRejectNotImplemented(reject);
}

- (void)cancelDiscovery:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject
{
  RNBCRejectNotImplemented(reject);
}

- (void)pair:(NSString *)address
   timeoutMs:(double)timeoutMs
     resolve:(RCTPromiseResolveBlock)resolve
      reject:(RCTPromiseRejectBlock)reject
{
  RNBCRejectNotImplemented(reject);
}

- (void)unpair:(NSString *)address
       resolve:(RCTPromiseResolveBlock)resolve
        reject:(RCTPromiseRejectBlock)reject
{
  RNBCRejectNotImplemented(reject);
}

- (void)getConnectedAccessories:(RCTPromiseResolveBlock)resolve
                         reject:(RCTPromiseRejectBlock)reject
{
  RNBCRejectNotImplemented(reject);
}

- (void)showAccessoryPicker:(NSString *_Nullable)nameFilter
                    resolve:(RCTPromiseResolveBlock)resolve
                     reject:(RCTPromiseRejectBlock)reject
{
  RNBCRejectNotImplemented(reject);
}

- (void)connect:(NSString *)operationId
       deviceId:(NSString *)deviceId
        options:(JS::NativeBluetoothClassic::NativeConnectOptions &)options
        resolve:(RCTPromiseResolveBlock)resolve
         reject:(RCTPromiseRejectBlock)reject
{
  RNBCRejectNotImplemented(reject);
}

- (void)accept:(NSString *)operationId
       options:(JS::NativeBluetoothClassic::NativeAcceptOptions &)options
       resolve:(RCTPromiseResolveBlock)resolve
        reject:(RCTPromiseRejectBlock)reject
{
  RNBCRejectNotImplemented(reject);
}

- (void)cancelOperation:(NSString *)operationId
                resolve:(RCTPromiseResolveBlock)resolve
                 reject:(RCTPromiseRejectBlock)reject
{
  RNBCRejectNotImplemented(reject);
}

- (void)cancelAccept:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject
{
  RNBCRejectNotImplemented(reject);
}

- (void)getConnections:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject
{
  resolve(@[]);
}

- (void)write:(NSString *)connectionId
         data:(NSString *)data
    timeoutMs:(double)timeoutMs
      resolve:(RCTPromiseResolveBlock)resolve
       reject:(RCTPromiseRejectBlock)reject
{
  RNBCRejectNotImplemented(reject);
}

- (void)disconnect:(NSString *)connectionId
         timeoutMs:(double)timeoutMs
           resolve:(RCTPromiseResolveBlock)resolve
            reject:(RCTPromiseRejectBlock)reject
{
  RNBCRejectNotImplemented(reject);
}

- (void)closeWithError:(NSString *)connectionId
                  code:(NSString *)code
               message:(NSString *)message
               resolve:(RCTPromiseResolveBlock)resolve
                reject:(RCTPromiseRejectBlock)reject
{
  RNBCRejectNotImplemented(reject);
}

- (std::shared_ptr<facebook::react::TurboModule>)getTurboModule:
    (const facebook::react::ObjCTurboModule::InitParams &)params
{
  return std::make_shared<facebook::react::NativeBluetoothClassicSpecJSI>(params);
}

+ (NSString *)moduleName
{
  return @"RNBluetoothClassic";
}

@end
