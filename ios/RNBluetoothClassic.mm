#import "RNBluetoothClassic.h"

#import <UIKit/UIKit.h>

// Pre-release stub. Reports every capability as unavailable until the iOS
// implementation (task group 7) lands.
@implementation RNBluetoothClassic

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
