export enum SocketEvent {
  // Notifications
  NOTIFICATION_NEW            = 'notification:new',

  // Visitors
  VISITOR_ENTRY               = 'visitor:entry',
  VISITOR_EXIT                = 'visitor:exit',
  VISITOR_APPROVED            = 'visitor:approved',
  VISITOR_DENIED              = 'visitor:denied',

  // Packages
  PACKAGE_REGISTERED          = 'package:registered',
  PACKAGE_READY               = 'package:ready',
  PACKAGE_DELIVERED           = 'package:delivered',

  // Finance
  FINANCE_CHARGE_NEW          = 'finance:charge:new',
  FINANCE_PAYMENT_REGISTERED  = 'finance:payment:registered',

  // Panic
  PANIC_ALERT_NEW             = 'panic:alert:new',
  PANIC_ALERT_ACKNOWLEDGED    = 'panic:alert:acknowledged',
}
