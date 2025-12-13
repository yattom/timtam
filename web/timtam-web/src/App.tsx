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
  const [joinMeetingId, setJoinMeetingId] = useState<string>('');
  const [attendeeId, setAttendeeId] = useState<string>('');

  const [audioInputs, setAudioInputs] = useState<MediaDeviceInfo[]>([]);
  const [audioOutputs, setAudioOutputs] = useState<MediaDeviceInfo[]>([]);
  const [selectedMic, setSelectedMic] = useState<string>('');
  const [selectedSpeaker, setSelectedSpeaker] = useState<string>('');
  const [joined, setJoined] = useState(false);
  const [muted, setMuted] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [micPermission, setMicPermission] = useState<'unknown' | 'granted' | 'denied'>('unknown');

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
    // Observe microphone permission if supported
    let permStatus: PermissionStatus | null = null;
    if ((navigator as any).permissions?.query) {
      (navigator as any).permissions
        .query({ name: 'microphone' as PermissionName })
        .then((status: PermissionStatus) => {
          permStatus = status;
          setMicPermission(status.state as any);
          status.onchange = () => setMicPermission(status.state as any);
        })
        .catch(() => {});
    }

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
    return () => {
      if (permStatus) permStatus.onchange = null as any;
      deviceController.removeDeviceChangeObserver(observer);
    };
  }, [deviceController]);

  const requestMicPermission = async () => {
    setError('');
    try {
      if (!navigator?.mediaDevices?.getUserMedia) throw new Error('getUserMedia not supported');
      // First, check if any audioinput devices exist
      const pre = await navigator.mediaDevices.enumerateDevices();
      const hasMic = pre.some(d => d.kind === 'audioinput');
      if (!hasMic) {
        throw new Error('Requested device not found: この端末で利用可能なマイクが見つからない');
      }
      // Request minimal audio access (no deviceId specified to avoid NotFoundError for stale ids)
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true } as any,
      });
      stream.getTracks().forEach(t => t.stop());
      // refresh devices after permission
      const inputs = await deviceController.listAudioInputDevices();
      const outputs = await deviceController.listAudioOutputDevices();
      setAudioInputs(inputs);
      setAudioOutputs(outputs);
      if (inputs[0]) setSelectedMic(inputs[0].deviceId ?? '');
      if (outputs[0]) setSelectedSpeaker(outputs[0].deviceId ?? '');
      setMicPermission('granted');
    } catch (e: any) {
      setMicPermission('denied');
      const name = e?.name ? `${e.name}: ` : '';
      setError(name + (e?.message || String(e)));
    }
  };

  const refreshDevices = async () => {
    try {
      const inputs = await deviceController.listAudioInputDevices();
      const outputs = await deviceController.listAudioOutputDevices();
      setAudioInputs(inputs);
      setAudioOutputs(outputs);
      if (!selectedMic && inputs[0]) setSelectedMic(inputs[0].deviceId ?? '');
      if (!selectedSpeaker && outputs[0]) setSelectedSpeaker(outputs[0].deviceId ?? '');
    } catch (e: any) {
      setError(e?.message || String(e));
    }
  };

  const configureAndStart = async (meeting: any, attendee: any) => {
    const logger = new ConsoleLogger('Chime', LogLevel.INFO);
    const configuration = new MeetingSessionConfiguration(meeting, attendee);
    const meetingSession = new DefaultMeetingSession(configuration, logger, deviceController);
    meetingRef.current = meetingSession as DefaultMeetingSession;
    const av = meetingSession.audioVideo;
    audioVideoRef.current = av;

    // Start mic if available; otherwise join receive-only
    try {
      if (selectedMic) {
        await av.startAudioInput(selectedMic as any);
      } else if (audioInputs.length > 0) {
        await av.startAudioInput();
      }
    } catch {
      // ignore; proceed receive-only
    }
    if (audioElRef.current) {
      await av.bindAudioElement(audioElRef.current);
    }
    await av.start();
    setJoined(true);
  };

  const onCreateAndJoin = async () => {
    setError('');
    try {
      const meetingResp = await createMeeting();
      const createdMeetingId: string | undefined = meetingResp?.meeting?.MeetingId;
      if (!createdMeetingId) throw new Error('CreateMeeting response missing meeting.MeetingId');
      const attendeeResp = await addAttendee(createdMeetingId);
      const createdAttendeeId: string | undefined = attendeeResp?.attendee?.AttendeeId;

      setMeetingId(createdMeetingId);
      setAttendeeId(createdAttendeeId || '');
      await configureAndStart(meetingResp.meeting, attendeeResp.attendee);
    } catch (e: any) {
      setError(e?.message || String(e));
    }
  };

  const onJoinExisting = async () => {
    setError('');
    try {
      const id = (joinMeetingId || '').trim();
      if (!id) throw new Error('meetingId を入力してね');
      const attendeeResp = await addAttendee(id);
      const meetingObj = attendeeResp?.meeting;
      const attendeeObj = attendeeResp?.attendee;
      const createdAttendeeId: string | undefined = attendeeObj?.AttendeeId;
      if (!meetingObj?.MeetingId) throw new Error('指定の meetingId が見つからないか、取得に失敗した');
      setMeetingId(meetingObj.MeetingId);
      setAttendeeId(createdAttendeeId || '');
      await configureAndStart(meetingObj, attendeeObj);
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
        {micPermission !== 'granted' && (
          <div style={{ background: '#fffbe6', border: '1px solid #f1c40f', padding: 8, borderRadius: 4 }}>
            <div style={{ marginBottom: 8 }}>マイクの許可が必要です。ボタンを押して許可ダイアログを出してください。</div>
            <button onClick={requestMicPermission}>マイク許可をリクエスト</button>
          </div>
        )}
        <div>
          <label>マイク: </label>
          <select value={selectedMic} onChange={(e) => onChangeMic(e.target.value)} disabled={joined && muted}>
            {audioInputs.map(d => (
              <option key={d.deviceId} value={d.deviceId}>{d.label || d.deviceId}</option>
            ))}
          </select>
          <button style={{ marginLeft: 8 }} onClick={refreshDevices}>デバイス更新</button>
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
            <>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <button onClick={onCreateAndJoin} disabled={!apiBaseUrl}>新規作成して入室</button>
                <span style={{ color: '#666' }}>または 既存会議に入室:</span>
                <input
                  type="text"
                  placeholder="meetingId"
                  value={joinMeetingId}
                  onChange={(e) => setJoinMeetingId(e.target.value)}
                  style={{ minWidth: 260 }}
                />
                <button onClick={onJoinExisting} disabled={!apiBaseUrl}>このIDで入室</button>
              </div>
            </>
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
        <p style={{ color: '#666' }}>meetingId: {meetingId || '-'} <button onClick={() => navigator.clipboard?.writeText(meetingId)} disabled={!meetingId}>コピー</button></p>
        <p style={{ color: '#666' }}>attendeeId: {attendeeId || '-'}</p>
      </section>
    </div>
  );
}
