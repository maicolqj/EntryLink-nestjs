import {
  canDevicePublish,
  canDeviceSubscribe,
  parseTopic,
  topicFor,
} from './iot-topics';

/** ACL del broker: cada matera solo toca SUS topics. */
describe('iot-topics', () => {
  it('construye y separa los topics del firmware', () => {
    expect(topicFor('NEXUS-7F3A9C', 'cmd')).toBe(
      'entrylink/devices/NEXUS-7F3A9C/cmd',
    );
    expect(parseTopic('entrylink/devices/NEXUS-7F3A9C/telemetry')).toEqual({
      deviceId: 'NEXUS-7F3A9C',
      suffix: 'telemetry',
    });
    expect(parseTopic('entrylink/devices/+/telemetry')).toBeNull();
    expect(parseTopic('otra/cosa')).toBeNull();
  });

  it('publica telemetry/status/ack solo de su propio deviceId', () => {
    expect(
      canDevicePublish('NEXUS-A', 'entrylink/devices/NEXUS-A/telemetry'),
    ).toBe(true);
    expect(
      canDevicePublish('NEXUS-A', 'entrylink/devices/NEXUS-A/status'),
    ).toBe(true);
    expect(canDevicePublish('NEXUS-A', 'entrylink/devices/NEXUS-A/ack')).toBe(
      true,
    );
    expect(
      canDevicePublish('NEXUS-A', 'entrylink/devices/NEXUS-B/telemetry'),
    ).toBe(false);
    // Una matera no puede mandarse comandos ni avisos a sí misma ni a otra
    expect(canDevicePublish('NEXUS-A', 'entrylink/devices/NEXUS-A/cmd')).toBe(
      false,
    );
    expect(
      canDevicePublish('NEXUS-A', 'entrylink/devices/NEXUS-B/notify'),
    ).toBe(false);
  });

  it('se suscribe solo a su cmd/notify, sin comodines', () => {
    expect(canDeviceSubscribe('NEXUS-A', 'entrylink/devices/NEXUS-A/cmd')).toBe(
      true,
    );
    expect(
      canDeviceSubscribe('NEXUS-A', 'entrylink/devices/NEXUS-A/notify'),
    ).toBe(true);
    expect(canDeviceSubscribe('NEXUS-A', 'entrylink/devices/NEXUS-B/cmd')).toBe(
      false,
    );
    expect(canDeviceSubscribe('NEXUS-A', 'entrylink/devices/#')).toBe(false);
    expect(
      canDeviceSubscribe('NEXUS-A', 'entrylink/devices/NEXUS-A/telemetry'),
    ).toBe(false);
  });
});
