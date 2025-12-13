import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ConsoleLogger,
  DefaultDeviceController,
  DefaultMeetingSession,
  LogLevel,
  MeetingSessionConfiguration,
  AudioVideoFacade,
  DeviceChangeObserver,
} from 'amazon-chime-sdk-js';
import { addAttendee, createMeeting, getConfig, startTranscription, stopTranscription } from './api';

export function App() {
  const [apiBaseUrl, setApiBaseUrl] = useState<string>('');
  const [loadingConfig, setLoadingConfig] = useState(true);
  const [error, setError] = useState<string>('');

  const [meetingId, setMeetingId] = useState<string>('');
  const [attendeeId, setAttendeeId] = useState<string>('');

  const [audioInputs, setAudioInputs] = useState<MediaDeviceInfo[]>([]);
  const [audioOutputs, setAudioOutputs] = useState<MediaDeviceInfo[]>([]);
  const [selectedMic, setSelectedMic] = useState<string>('');
  const [selectedSpeaker, setSelectedSpeaker] = useState<string>('');
  const [joined, setJoined] = useState(false);
  const [muted, setMuted] = useState(false);
  const [transcribing, setTranscribing] = useState(false);

  const audioElRef = useRef<HTMLAudioElement | null>(null);
  const meetingRef = useRef<DefaultMeetingSession | null>(null);
  const audioVideoRef = useRef<AudioVideoFacade | null>(null);
  const deviceController = useMemo(() => new DefaultDeviceController(new ConsoleLogger('dc', LogLevel.WARN)), []);

  useEffect(() => {
    (async () => {
      try {
        const cfg = await getConfig();
        setApiBaseUrl(cfg.apiBaseUrl);
      } catch (e: any) {
        setError(e?.message || String(e));
      } finally {
        setLoadingConfig(false);
      }
    })();
  }, []);

  useEffect(() => {
    const observer: DeviceChangeObserver = {
      audioInputsChanged: (devices) => setAudioInputs(devices ?? []),
      audioOutputsChanged: (devices) => setAudioOutputs(devices ?? []),
    };
    deviceController.addDeviceChangeObserver(observer);
    (async () => {
      const inputs = await deviceController.listAudioInputDevices();
      const outputs = await deviceController.listAudioOutputDevices();
      setAudioInputs(inputs);
      setAudioOutputs(outputs);
      if (inputs[0]) setSelectedMic(inputs[0].deviceId ?? '');
      if (outputs[0]) setSelectedSpeaker(outputs[0].deviceId ?? '');
    })();
    return () => deviceController.removeDeviceChangeObserver(observer);
  }, [deviceController]);

  const onJoin = async () => {
    setError('');
    try {
      const meeting = await createMeeting();
      const attendee = await addAttendee(meeting.Meeting.MeetingId);

      setMeetingId(meeting.Meeting.MeetingId);
      setAttendeeId(attendee.Attendee.AttendeeId);

      const logger = new ConsoleLogger('Chime', LogLevel.INFO);
      const configuration = new MeetingSessionConfiguration(meeting, attendee);
      const meetingSession = new DefaultMeetingSession(configuration, logger, deviceController);
      meetingRef.current = meetingSession as DefaultMeetingSession;
      const av = meetingSession.audioVideo;
      audioVideoRef.current = av;

      if (selectedMic) {
        await av.startAudioInput(selectedMic);
      }
      if (audioElRef.current) {
        await av.bindAudioElement(audioElRef.current);
      }
      await av.start();
      setJoined(true);
    } catch (e: any) {
      setError(e?.message || String(e));
    }
  };

  const onLeave = async () => {
    try {
      audioVideoRef.current?.stop();
      meetingRef.current?.destroy();
    } catch {}
    setJoined(false);
    setTranscribing(false);
  };

  const onToggleMute = async () => {
    const av = audioVideoRef.current;
    if (!av) return;
    try {
      if (muted) {
        await av.realtimeUnmuteLocalAudio();
        setMuted(false);
      } else {
        await av.realtimeMuteLocalAudio();
        setMuted(true);
      }
    } catch (e: any) {
      setError(e?.message || String(e));
    }
  };

  const onStartTranscription = async () => {
    if (!meetingId) return;
    try {
      await startTranscription(meetingId);
      setTranscribing(true);
    } catch (e: any) {
      setError(e?.message || String(e));
    }
  };

  const onStopTranscription = async () => {
    if (!meetingId) return;
    try {
      await stopTranscription(meetingId);
      setTranscribing(false);
    } catch (e: any) {
      setError(e?.message || String(e));
    }
  };

  const onChangeMic = async (id: string) => {
    setSelectedMic(id);
    // Use audioVideo API; cast to any to accommodate SDK typing differences across versions
    const av: any = audioVideoRef.current as any;
    if (av && typeof av.chooseAudioInputDevice === 'function') {
      await av.chooseAudioInputDevice(id);
    }
  };

  const onChangeSpeaker = async (id: string) => {
    setSelectedSpeaker(id);
    // amazon-chime-sdk-js uses setSinkId on the bound audio element
    if (audioElRef.current && 'setSinkId' in (audioElRef.current as any)) {
      try { await (audioElRef.current as any).setSinkId(id); } catch {}
    }
  };

  return (
    <div style={{ fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif', padding: 16, maxWidth: 900 }}>
      <h1 style={{ marginTop: 0 }}>timtam web — 会議MVP</h1>
      {loadingConfig ? (
        <p>設定を取得中...</p>
      ) : (
        <p style={{ color: '#666' }}>API: {apiBaseUrl || '(未取得)'}</p>
      )}
      {error && (
        <div style={{ color: 'white', background: '#c0392b', padding: 8, borderRadius: 4, marginBottom: 12 }}>{error}</div>
      )}

      <section style={{ display: 'grid', gap: 12, marginBottom: 16 }}>
        <div>
          <label>マイク: </label>
          <select value={selectedMic} onChange={(e) => onChangeMic(e.target.value)} disabled={joined && muted}>
            {audioInputs.map(d => (
              <option key={d.deviceId} value={d.deviceId}>{d.label || d.deviceId}</option>
            ))}
          </select>
        </div>
        <div>
          <label>スピーカー: </label>
          <select value={selectedSpeaker} onChange={(e) => onChangeSpeaker(e.target.value)}>
            {audioOutputs.map(d => (
              <option key={d.deviceId} value={d.deviceId}>{d.label || d.deviceId}</option>
            ))}
          </select>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {!joined ? (
            <button onClick={onJoin} disabled={!apiBaseUrl}>入室</button>
          ) : (
            <>
              <button onClick={onLeave}>退室</button>
              <button onClick={onToggleMute}>{muted ? 'ミュート解除' : 'ミュート'}</button>
              {!transcribing ? (
                <button onClick={onStartTranscription}>文字起こし開始</button>
              ) : (
                <button onClick={onStopTranscription}>停止</button>
              )}
            </>
          )}
        </div>
        <audio ref={audioElRef} autoPlay />
      </section>

      <section>
        <h3>ログ</h3>
        <p style={{ color: '#666' }}>meetingId: {meetingId || '-'}, attendeeId: {attendeeId || '-'}</p>
      </section>
    </div>
  );
}
