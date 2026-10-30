#import "RNBluetoothClassic.h"
#import "RNBCErrorCode.h"

#if __has_include(<dynlabs_react_native_bluetooth_classic/dynlabs_react_native_bluetooth_classic-Swift.h>)
#import <dynlabs_react_native_bluetooth_classic/dynlabs_react_native_bluetooth_classic-Swift.h>
#else
#import "dynlabs_react_native_bluetooth_classic-Swift.h"
#endif

// The TurboModule glue. Every call is forwarded to the Swift core (RNBCCore,
// in ios/Core), which settles each promise exactly once and never throws a
// Swift error. RNBCGuard turns an Objective-C exception into an UNKNOWN
// rejection, so nothing escapes to React Native.

using RNBCReject = void (^)(NSString *code, NSString *message, NSDictionary<NSString *, id> *userInfo);

static RNBCReject RNBCRejecter(RCTPromiseRejectBlock reject)
{
  return ^(NSString *code, NSString *message, NSDictionary<NSString *, id> *userInfo) {
    // React Native passes the NSError's userInfo to JS as `error.userInfo`.
    reject(code, message, [NSError errorWithDomain:@"RNBluetoothClassic" code:0 userInfo:userInfo]);
  };
}

static void RNBCGuard(RCTPromiseRejectBlock reject, void (^body)(void))
{
  @try {
    body();
  } @catch (NSException *exception) {
    NSString *reason = exception.reason ?: exception.name;
    reject(
        RNBCErrorCode_UNKNOWN,
        [NSString stringWithFormat:@"Unexpected failure: %@", reason],
        [NSError errorWithDomain:@"RNBluetoothClassic"
                            code:0
                        userInfo:@{@"nativeCode" : exception.name, @"nativeMessage" : reason}]);
  }
}

@implementation RNBluetoothClassic {
  RNBCCore *_core;
}

- (instancetype)init
{
  if (self = [super init]) {
    __weak RNBluetoothClassic *weakSelf = self;
    _core = [[RNBCCore alloc] initWithEmit:^(NSString *name, NSDictionary<NSString *, id> *body) {
      [weakSelf emit:name body:body];
    }];
  }
  return self;
}

+ (BOOL)requiresMainQueueSetup
{
  return NO;
}

- (void)emit:(NSString *)name body:(NSDictionary *)body
{
  if ([name isEqualToString:@"onData"]) {
    [self emitOnData:body];
  } else if ([name isEqualToString:@"onConnectionStateChange"]) {
    [self emitOnConnectionStateChange:body];
  } else if ([name isEqualToString:@"onAccessoryConnected"]) {
    [self emitOnAccessoryConnected:body];
  } else if ([name isEqualToString:@"onAccessoryDisconnected"]) {
    [self emitOnAccessoryDisconnected:body];
  }
}

// Runs when the JS runtime is reloaded or destroyed: sessions close and
// nothing is delivered to the next runtime.
- (void)invalidate
{
  [_core invalidate];
}

- (void)unsupported:(NSString *)operation resolve:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject
{
  RNBCGuard(reject, ^{
    [self->_core unsupported:operation resolve:resolve reject:RNBCRejecter(reject)];
  });
}

#pragma mark - Platform

- (NSDictionary *)getCapabilities
{
  @try {
    return [_core capabilities];
  } @catch (NSException *exception) {
    return @{@"platform" : @"ios", @"osVersion" : @"", @"discovery" : @NO, @"pairing" : @NO, @"server" : @NO,
             @"adapterState" : @NO, @"requestEnable" : @NO, @"bondLossEvents" : @NO, @"accessoryPicker" : @NO,
             @"declaredProtocols" : @[]};
  }
}

- (void)setLogLevel:(NSString *)level
{
  [_core setLogLevel:level];
}

#pragma mark - Adapter

- (void)getAdapterState:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject
{
  [self unsupported:@"getAdapterState" resolve:resolve reject:reject];
}

- (void)requestEnable:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject
{
  [self unsupported:@"requestEnable" resolve:resolve reject:reject];
}

- (void)openSettings:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject
{
  RNBCGuard(reject, ^{
    [self->_core openSettingsWithResolve:resolve reject:RNBCRejecter(reject)];
  });
}

- (void)setAdapterName:(NSString *)name
               resolve:(RCTPromiseResolveBlock)resolve
                reject:(RCTPromiseRejectBlock)reject
{
  [self unsupported:@"setAdapterName" resolve:resolve reject:reject];
}

#pragma mark - Permissions

- (void)checkPermissions:(NSString *)scope
                 resolve:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject
{
  RNBCGuard(reject, ^{
    [self->_core checkPermissions:scope resolve:resolve reject:RNBCRejecter(reject)];
  });
}

// No permission prompt exists for ExternalAccessory, so this reports like checkPermissions.
- (void)requestPermissions:(NSString *)scope
                   resolve:(RCTPromiseResolveBlock)resolve
                    reject:(RCTPromiseRejectBlock)reject
{
  [self checkPermissions:scope resolve:resolve reject:reject];
}

#pragma mark - Discovery and pairing (Android only)

- (void)getBondedDevices:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject
{
  [self unsupported:@"getBondedDevices" resolve:resolve reject:reject];
}

- (void)startDiscovery:(double)timeoutMs
               resolve:(RCTPromiseResolveBlock)resolve
                reject:(RCTPromiseRejectBlock)reject
{
  [self unsupported:@"startDiscovery" resolve:resolve reject:reject];
}

- (void)cancelDiscovery:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject
{
  [self unsupported:@"cancelDiscovery" resolve:resolve reject:reject];
}

- (void)pair:(NSString *)address
   timeoutMs:(double)timeoutMs
     resolve:(RCTPromiseResolveBlock)resolve
      reject:(RCTPromiseRejectBlock)reject
{
  [self unsupported:@"pair" resolve:resolve reject:reject];
}

- (void)unpair:(NSString *)address
       resolve:(RCTPromiseResolveBlock)resolve
        reject:(RCTPromiseRejectBlock)reject
{
  [self unsupported:@"unpair" resolve:resolve reject:reject];
}

#pragma mark - Accessories

- (void)getConnectedAccessories:(RCTPromiseResolveBlock)resolve
                         reject:(RCTPromiseRejectBlock)reject
{
  RNBCGuard(reject, ^{
    [self->_core getConnectedAccessoriesWithResolve:resolve reject:RNBCRejecter(reject)];
  });
}

- (void)showAccessoryPicker:(NSString *_Nullable)nameFilter
                    resolve:(RCTPromiseResolveBlock)resolve
                     reject:(RCTPromiseRejectBlock)reject
{
  RNBCGuard(reject, ^{
    [self->_core showAccessoryPicker:nameFilter resolve:resolve reject:RNBCRejecter(reject)];
  });
}

#pragma mark - Connections

- (void)connect:(NSString *)operationId
       deviceId:(NSString *)deviceId
        options:(JS::NativeBluetoothClassic::NativeConnectOptions &)options
        resolve:(RCTPromiseResolveBlock)resolve
         reject:(RCTPromiseRejectBlock)reject
{
  // Copied out of the C++ struct before the block captures them.
  double timeoutMs = options.timeoutMs();
  NSString *protocolString = options.protocol();
  RNBCGuard(reject, ^{
    [self->_core connect:operationId
                deviceId:deviceId
          protocolString:protocolString
               timeoutMs:timeoutMs
                 resolve:resolve
                  reject:RNBCRejecter(reject)];
  });
}

- (void)accept:(NSString *)operationId
       options:(JS::NativeBluetoothClassic::NativeAcceptOptions &)options
       resolve:(RCTPromiseResolveBlock)resolve
        reject:(RCTPromiseRejectBlock)reject
{
  [self unsupported:@"accept" resolve:resolve reject:reject];
}

- (void)cancelOperation:(NSString *)operationId
                resolve:(RCTPromiseResolveBlock)resolve
                 reject:(RCTPromiseRejectBlock)reject
{
  RNBCGuard(reject, ^{
    [self->_core cancelOperation:operationId resolve:resolve reject:RNBCRejecter(reject)];
  });
}

- (void)cancelAccept:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject
{
  [self unsupported:@"cancelAccept" resolve:resolve reject:reject];
}

- (void)getConnections:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject
{
  RNBCGuard(reject, ^{
    [self->_core getConnectionsWithResolve:resolve reject:RNBCRejecter(reject)];
  });
}

- (void)write:(NSString *)connectionId
         data:(NSString *)data
    timeoutMs:(double)timeoutMs
      resolve:(RCTPromiseResolveBlock)resolve
       reject:(RCTPromiseRejectBlock)reject
{
  RNBCGuard(reject, ^{
    [self->_core write:connectionId data:data timeoutMs:timeoutMs resolve:resolve reject:RNBCRejecter(reject)];
  });
}

- (void)disconnect:(NSString *)connectionId
         timeoutMs:(double)timeoutMs
           resolve:(RCTPromiseResolveBlock)resolve
            reject:(RCTPromiseRejectBlock)reject
{
  RNBCGuard(reject, ^{
    [self->_core disconnect:connectionId timeoutMs:timeoutMs resolve:resolve reject:RNBCRejecter(reject)];
  });
}

- (void)closeWithError:(NSString *)connectionId
                  code:(NSString *)code
               message:(NSString *)message
               resolve:(RCTPromiseResolveBlock)resolve
                reject:(RCTPromiseRejectBlock)reject
{
  RNBCGuard(reject, ^{
    [self->_core closeWithError:connectionId code:code message:message resolve:resolve reject:RNBCRejecter(reject)];
  });
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
