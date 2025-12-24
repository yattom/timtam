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
import { addAttendee, createMeeting, getConfig, startTranscription, stopTranscription, getAiMessages, AiMessage, getOrchestratorPrompt, updateOrchestratorPrompt, sendTranscriptionEvent, upsertParticipantProfile, getParticipants, endMeeting } from './api';

const ANIMAL_NAMES = [
  'ねこ', 'いぬ', 'うさぎ', 'ぞう', 'らいおん', 'きつね', 'たぬき', 'しか', 'さる', 'ごりら',
  'くま', 'とら', 'かめ', 'ぺんぎん', 'ぱんだ', 'ひつじ', 'やぎ', 'うま', 'しか', 'らくだ',
  'いるか', 'らっこ', 'かものはし', 'なまけもの', 'ふくろう', 'かえる', 'おっとせい'
];

const NAME_STORAGE_KEY = 'timtam.displayName';

type FinalSegment = { text: string; at: number; speakerAttendeeId?: string; speakerExternalUserId?: string };

const randomAnimalName = () => ANIMAL_NAMES[Math.floor(Math.random() * ANIMAL_NAMES.length)] || 'どうぶつ';

export function App() {
  const [apiBaseUrl, setApiBaseUrl] = useState<string>('');
  const [loadingConfig, setLoadingConfig] = useState(true);
  const [error, setError] = useState<string>('');

  const [meetingId, setMeetingId] = useState<string>('');
  const [joinMeetingId, setJoinMeetingId] = useState<string>('');
  const [attendeeId, setAttendeeId] = useState<string>('');
  const [externalUserId, setExternalUserId] = useState<string>('');
  const [displayName, setDisplayName] = useState<string>('');
  const [nameMessage, setNameMessage] = useState<string>('');
  const [meetingEndedAt, setMeetingEndedAt] = useState<number | null>(null);

  const [audioInputs, setAudioInputs] = useState<MediaDeviceInfo[]>([]);
  const [audioOutputs, setAudioOutputs] = useState<MediaDeviceInfo[]>([]);
  const [selectedMic, setSelectedMic] = useState<string>('');
  const [selectedSpeaker, setSelectedSpeaker] = useState<string>('');
  const [joined, setJoined] = useState(false);
  const [muted, setMuted] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [micPermission, setMicPermission] = useState<'unknown' | 'granted' | 'denied'>('unknown');
  // Transcript states
  const [partialText, setPartialText] = useState<string>('');
  const [finalSegments, setFinalSegments] = useState<FinalSegment[]>([]);
  const [participantNames, setParticipantNames] = useState<Record<string, string>>({});
  // AI messages
  const [aiMessages, setAiMessages] = useState<AiMessage[]>([]);
  const [lastAiMessageTimestamp, setLastAiMessageTimestamp] = useState<number>(0);
  // AI output area resize
  const [aiOutputHeight, setAiOutputHeight] = useState<number>(300);
  // Orchestrator prompt configuration
  const [orchestratorPrompt, setOrchestratorPrompt] = useState<string>('');
  const [promptEditing, setPromptEditing] = useState<string>('');
  const [promptSaving, setPromptSaving] = useState(false);
  const [promptMessage, setPromptMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  // (debug states removed)

  const audioElRef = useRef<HTMLAudioElement | null>(null);
  const meetingRef = useRef<DefaultMeetingSession | null>(null);
  const audioVideoRef = useRef<AudioVideoFacade | null>(null);
  const transcriptHandlerRef = useRef<((event: any) => void) | null>(null);
  const aiOutputRef = useRef<HTMLDivElement | null>(null);
  const participantNamesRef = useRef<Record<string, string>>({});
  const pendingNameLookupsRef = useRef<Set<string>>(new Set());
  const meetingIdRef = useRef<string>('');
  const deviceController = useMemo(() => new DefaultDeviceController(new ConsoleLogger('dc', LogLevel.WARN)), []);

  useEffect(() => {
    const storedName = (typeof localStorage !== 'undefined') ? localStorage.getItem(NAME_STORAGE_KEY) : null;
    if (storedName) {
      setDisplayName(storedName);
    } else {
      setDisplayName(randomAnimalName());
    }
  }, []);

  useEffect(() => {
    participantNamesRef.current = participantNames;
  }, [participantNames]);

  useEffect(() => {
    meetingIdRef.current = meetingId;
  }, [meetingId]);

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

  // Load orchestrator prompt on mount
  useEffect(() => {
    if (!apiBaseUrl) return;
    (async () => {
      try {
        const result = await getOrchestratorPrompt();
        setOrchestratorPrompt(result.prompt);
        setPromptEditing(result.prompt);
      } catch (e: any) {
        console.error('Failed to load orchestrator prompt:', e?.message || e);
      }
    })();
  }, [apiBaseUrl]);

  const persistDisplayName = (name: string) => {
    const trimmed = (name || '').trim();
    const resolved = trimmed || randomAnimalName();
    setDisplayName(resolved);
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(NAME_STORAGE_KEY, resolved);
    }
    return resolved;
  };

  const updateParticipantNames = (entries: Record<string, string>) => {
    setParticipantNames((prev) => {
      const next = { ...prev };
      let changed = false;
      for (const [k, v] of Object.entries(entries)) {
        if (v && next[k] !== v) {
          next[k] = v;
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  };

  const fetchParticipantsByIds = async (ids: (string | undefined)[]) => {
    if (!meetingIdRef.current) return;
    const targets = ids.filter((id): id is string => !!id && !participantNamesRef.current[id]);
    const uniqueTargets = targets.filter((id) => !pendingNameLookupsRef.current.has(id));
    if (uniqueTargets.length === 0) return;

    uniqueTargets.forEach((id) => pendingNameLookupsRef.current.add(id));
    try {
      const res = await getParticipants(meetingIdRef.current, uniqueTargets);
      const updates: Record<string, string> = {};
      for (const p of res.participants || []) {
        const label = p.displayName || p.attendeeId || p.externalUserId;
        if (p.attendeeId) updates[p.attendeeId] = label;
        if (p.externalUserId) updates[p.externalUserId] = label;
      }
      if (Object.keys(updates).length > 0) {
        updateParticipantNames(updates);
      }
    } catch (e) {
      console.error('Failed to fetch participant names', e);
    } finally {
      uniqueTargets.forEach((id) => pendingNameLookupsRef.current.delete(id));
    }
  };

  const resolveSpeakerLabel = (seg: FinalSegment) => {
    for (const id of [seg.speakerAttendeeId, seg.speakerExternalUserId]) {
      if (id && participantNames[id]) return participantNames[id];
    }
    return seg.speakerAttendeeId || seg.speakerExternalUserId;
  };

  const registerParticipantProfile = async (meetingIdValue: string, attendee: any, nameOverride?: string) => {
    const attendeeKey: string | undefined = attendee?.AttendeeId || attendee?.attendeeId;
    const externalUserIdValue: string | undefined = attendee?.ExternalUserId || attendee?.externalUserId;
    if (!attendeeKey) return;

    const resolvedName = persistDisplayName(nameOverride ?? displayName);
    updateParticipantNames({
      [attendeeKey]: resolvedName,
      ...(externalUserIdValue ? { [externalUserIdValue]: resolvedName } : {}),
    });

    try {
      await upsertParticipantProfile(meetingIdValue, {
        attendeeId: attendeeKey,
        externalUserId: externalUserIdValue,
        displayName: resolvedName,
        startedAt: Date.now(),
      });
    } catch (e: any) {
      setError(e?.message || String(e));
    }
  };

  const refreshParticipantDirectory = async (meetingIdValue: string) => {
    try {
      const res = await getParticipants(meetingIdValue);
      const updates: Record<string, string> = {};
      for (const p of res.participants || []) {
        const label = p.displayName || p.attendeeId || p.externalUserId;
        if (p.attendeeId) updates[p.attendeeId] = label;
        if (p.externalUserId) updates[p.externalUserId] = label;
      }
      if (Object.keys(updates).length > 0) updateParticipantNames(updates);
      if (typeof res.endedAt === 'number') {
        setMeetingEndedAt(res.endedAt);
      } else {
        setMeetingEndedAt(null);
      }
    } catch (e) {
      console.error('Failed to refresh participants', e);
    }
  };

  const onSaveDisplayName = async () => {
    const saved = persistDisplayName(displayName);
    setNameMessage('名前を保存したよ');
    setTimeout(() => setNameMessage(''), 2000);
    if (joined && meetingId && attendeeId) {
      await registerParticipantProfile(
        meetingId,
        { AttendeeId: attendeeId, ExternalUserId: externalUserId },
        saved
      );
    }
  };

  // Poll for AI messages when joined
  useEffect(() => {
    if (!joined || !meetingId) return;

    let lastTimestamp = 0;

    const pollMessages = async () => {
      try {
        const messages = await getAiMessages(meetingId, lastTimestamp);
        if (messages.length > 0) {
          setAiMessages(prev => [...prev, ...messages]);
          const maxTimestamp = Math.max(...messages.map(m => m.timestamp));
          lastTimestamp = maxTimestamp;
        }
      } catch (e: any) {
        console.error('Failed to poll AI messages:', e?.message || e);
      }
    };

    // Poll every 2 seconds
    const intervalId = setInterval(pollMessages, 2000);
    // Initial poll
    pollMessages();

    return () => clearInterval(intervalId);
  }, [joined, meetingId]);

  // Auto-scroll AI output area when new messages arrive
  useEffect(() => {
    const container = aiOutputRef.current;
    if (!container || aiMessages.length === 0) return;

    // Check if user is at the bottom (with 50px tolerance)
    const isAtBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 50;

    if (isAtBottom) {
      // Auto-scroll to bottom
      container.scrollTop = container.scrollHeight;
    }
  }, [aiMessages]);

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
    const logger = new ConsoleLogger('Chime', LogLevel.WARN);
    const configuration = new MeetingSessionConfiguration(meeting, attendee);
    const meetingSession = new DefaultMeetingSession(configuration, logger, deviceController);
    meetingRef.current = meetingSession as DefaultMeetingSession;
    const av = meetingSession.audioVideo;
    audioVideoRef.current = av;

    // Extract meetingId from meeting object to avoid closure capturing empty state
    const currentMeetingId = meeting.MeetingId;

    // Bind speaker output first so remote audio can play even without mic
    if (audioElRef.current) {
      await av.bindAudioElement(audioElRef.current);
      // Try to direct output to selected speaker if supported
      try {
        if (selectedSpeaker && 'setSinkId' in (audioElRef.current as any)) {
          await (audioElRef.current as any).setSinkId(selectedSpeaker);
        } else if ('setSinkId' in (audioElRef.current as any)) {
          await (audioElRef.current as any).setSinkId('default');
        }
      } catch {
        // Ignore setSinkId failures (e.g., HTTP or unsupported)
      }
    }

    // Start mic if available; otherwise join receive-only
    try {
      if (selectedMic) {
        await av.startAudioInput(selectedMic as any);
      } else if (audioInputs.length > 0) {
        // In some SDK versions, startAudioInput requires a device parameter; attempt with the first device
        await av.startAudioInput(audioInputs[0].deviceId as any);
      }
    } catch {
      // ignore; proceed receive-only
    }
    await av.start();
    // Subscribe to transcription events (if supported by SDK)
    try {
      const tc: any = (av as any).transcriptionController;
      const available = !!(tc && typeof tc.subscribeToTranscriptEvent === 'function');
      if (available) {
        const handler = (event: any) => {
          try {
            // Some SDKs provide different casing/shape; normalize
            const rawResults = event?.Transcript?.Results ?? event?.transcript?.results ?? event?.results ?? [];
            const results: any[] = Array.isArray(rawResults) ? rawResults : [];
            if (!Array.isArray(results) || results.length === 0) {
              return;
            }
            for (const r of results) {
              const isPartial = !!(r?.IsPartial ?? r?.isPartial);
              const alt = r?.Alternatives?.[0] ?? r?.alternatives?.[0];
              // Text may be in alt.Transcript or needs to be reconstructed from Items
              let text: string = alt?.Transcript ?? alt?.transcript ?? '';
              if (!text && Array.isArray(alt?.Items)) {
                text = (alt.Items as any[]).map((it: any) => it?.Content ?? it?.content ?? '').join('');
              }
              if (!text) continue;

              // Extract speaker information from TranscriptEvent
              // TranscriptEvent Items contain Attendee with attendeeId and externalUserId
              const items = alt?.Items ?? alt?.items ?? [];
              let speakerAttendeeId: string | undefined;
              let speakerExternalUserId: string | undefined;

              if (Array.isArray(items) && items.length > 0) {
                // Get attendee info from first item (all items in result have same speaker)
                const firstItem = items[0];
                const attendeeInfo = firstItem?.Attendee ?? firstItem?.attendee;
                speakerAttendeeId = attendeeInfo?.AttendeeId ?? attendeeInfo?.attendeeId;
                speakerExternalUserId = attendeeInfo?.ExternalUserId ?? attendeeInfo?.externalUserId;
              }

              if (speakerAttendeeId || speakerExternalUserId) {
                fetchParticipantsByIds([speakerAttendeeId, speakerExternalUserId]);
              }

              // Update UI
              if (isPartial) {
                setPartialText(text);
              } else {
                // Finalized: append and clear partial if it matches
                setFinalSegments(prev => [...prev, { text, at: Date.now(), speakerAttendeeId, speakerExternalUserId }]);
                setPartialText('');
              }

              // Send transcription event to server (with speaker info)
              if (currentMeetingId && text) {
                sendTranscriptionEvent(
                  currentMeetingId,
                  speakerAttendeeId || speakerExternalUserId || 'unknown',
                  speakerExternalUserId,
                  text,
                  !isPartial
                ).catch(err => {
                  console.error('Failed to send transcription event:', err);
                });
              }
            }
          } catch {
            // ignore parsing errors
          }
        };
        transcriptHandlerRef.current = handler;
        tc.subscribeToTranscriptEvent(handler);
      }
      // Fallback subscription API for older SDKs if available
      const fallback = (av as any).realtimeSubscribeToReceiveTranscriptionEvent;
      if (typeof fallback === 'function') {
        const fbHandler = (evt: any) => {
          try {
            const results: any[] = evt?.results ?? evt?.Transcript?.Results ?? [];
            if (!Array.isArray(results)) return;
            for (const r of results) {
              const isPartial = !!(r?.isPartial ?? r?.IsPartial);
              const alt = r?.alternatives?.[0] ?? r?.Alternatives?.[0];
              let text: string = alt?.transcript ?? alt?.Transcript ?? '';
              if (!text && Array.isArray(alt?.Items)) {
                text = (alt.Items as any[]).map((it: any) => it?.Content ?? it?.content ?? '').join('');
              }
              if (!text) continue;

              // Extract speaker information from fallback event format
              const items = alt?.Items ?? alt?.items ?? [];
              let speakerAttendeeId: string | undefined;
              let speakerExternalUserId: string | undefined;

              if (Array.isArray(items) && items.length > 0) {
                const firstItem = items[0];
                const attendeeInfo = firstItem?.Attendee ?? firstItem?.attendee;
                speakerAttendeeId = attendeeInfo?.AttendeeId ?? attendeeInfo?.attendeeId;
                speakerExternalUserId = attendeeInfo?.ExternalUserId ?? attendeeInfo?.externalUserId;
              }

              if (speakerAttendeeId || speakerExternalUserId) {
                fetchParticipantsByIds([speakerAttendeeId, speakerExternalUserId]);
              }

              // Update UI
              if (isPartial) {
                setPartialText(text);
              } else {
                setFinalSegments(prev => [...prev, { text, at: Date.now(), speakerAttendeeId, speakerExternalUserId }]);
                setPartialText('');
              }

              // Send transcription event to server (with speaker info)
              if (currentMeetingId && text) {
                sendTranscriptionEvent(
                  currentMeetingId,
                  speakerAttendeeId || speakerExternalUserId || 'unknown',
                  speakerExternalUserId,
                  text,
                  !isPartial
                ).catch(err => {
                  console.error('Failed to send transcription event:', err);
                });
              }
            }
          } catch {}
        };
        fallback.call(av, fbHandler);
      }
    } catch {
      // ignore if not supported
    }
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
      meetingIdRef.current = createdMeetingId; // Update ref immediately for handlers
      setAttendeeId(createdAttendeeId || '');
      setExternalUserId(attendeeResp?.attendee?.ExternalUserId || '');
      setMeetingEndedAt(null);
      await registerParticipantProfile(createdMeetingId, attendeeResp.attendee);
      await refreshParticipantDirectory(createdMeetingId);
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
      meetingIdRef.current = meetingObj.MeetingId; // Update ref immediately for handlers
      setAttendeeId(createdAttendeeId || '');
      setExternalUserId(attendeeObj?.ExternalUserId || '');
      setMeetingEndedAt(null);
      await registerParticipantProfile(meetingObj.MeetingId, attendeeObj);
      await refreshParticipantDirectory(meetingObj.MeetingId);
      await configureAndStart(meetingObj, attendeeObj);
    } catch (e: any) {
      setError(e?.message || String(e));
    }
  };

  const onLeave = async () => {
    try {
      // Unsubscribe transcript events
      const av: any = audioVideoRef.current as any;
      const tc: any = av?.transcriptionController;
      if (tc && transcriptHandlerRef.current && typeof tc.unsubscribeFromTranscriptEvent === 'function') {
        tc.unsubscribeFromTranscriptEvent(transcriptHandlerRef.current);
      }
      audioVideoRef.current?.stop();
      meetingRef.current?.destroy();
    } catch {}
    setJoined(false);
    setTranscribing(false);
    setPartialText('');
    setFinalSegments([]);
    setAiMessages([]);
    setLastAiMessageTimestamp(0);
    setParticipantNames({});
    participantNamesRef.current = {};
    setMeetingEndedAt(null);
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
      setPartialText('');
    } catch (e: any) {
      setError(e?.message || String(e));
    }
  };

  const onEndMeeting = async () => {
    if (!meetingId) return;
    try {
      const res = await endMeeting(meetingId);
      setMeetingEndedAt(res?.endedAt ?? Date.now());
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
      try { await (audioElRef.current as any).setSinkId(id); } catch (e) {
        // Some browsers require HTTPS for setSinkId; ignore failure
      }
    }
  };

  const onResizeStart = (e: React.MouseEvent) => {
    e.preventDefault();
    const startY = e.clientY;
    const startHeight = aiOutputHeight;

    const onMouseMove = (moveEvent: MouseEvent) => {
      const deltaY = moveEvent.clientY - startY;
      const newHeight = Math.max(100, Math.min(800, startHeight + deltaY));
      setAiOutputHeight(newHeight);
    };

    const onMouseUp = () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  };

  const onSavePrompt = async () => {
    setPromptSaving(true);
    setPromptMessage(null);
    try {
      await updateOrchestratorPrompt(promptEditing);
      setOrchestratorPrompt(promptEditing);
      setPromptMessage({ type: 'success', text: 'プロンプトを保存しました' });
      setTimeout(() => setPromptMessage(null), 3000);
    } catch (e: any) {
      setPromptMessage({ type: 'error', text: e?.message || String(e) });
    } finally {
      setPromptSaving(false);
    }
  };

  const onResetPrompt = () => {
    setPromptEditing(orchestratorPrompt);
    setPromptMessage(null);
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

      <section style={{ display: 'grid', gap: 8, marginBottom: 16 }}>
        <h3>あなたの名前</h3>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <input
            type="text"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="ひらがなで入力（未入力ならランダム動物名）"
            maxLength={50}
            style={{ padding: 8, borderRadius: 4, border: '1px solid #ccc', minWidth: 220 }}
          />
          <button onClick={onSaveDisplayName}>保存</button>
          {nameMessage && <span style={{ color: '#27ae60', fontSize: 14 }}>{nameMessage}</span>}
        </div>
        <div style={{ color: '#666', fontSize: 13 }}>
          会議に入るとき、この名前とChimeのattendeeIdをDynamoDBに保存して全員に表示するよ。
          未入力ならランダムで動物の名前を入れておくね。
        </div>
        {meetingEndedAt && (
          <div style={{ color: '#c0392b', fontSize: 13 }}>
            この会議は終了済みとして記録されています（{new Date(meetingEndedAt).toLocaleString('ja-JP')}）。
          </div>
        )}
      </section>

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
          {audioOutputs.length === 0 && (
            <span style={{ marginLeft: 8, color: '#666' }}>出力デバイスが見つからない場合も再生は既定デバイスで行われます。</span>
          )}
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
              <button onClick={onEndMeeting} disabled={!!meetingEndedAt}>会議終了を記録</button>
            </>
          )}
        </div>
        <audio ref={audioElRef} autoPlay />
      </section>

      <section style={{ display: 'grid', gap: 8 }}>
        <h3>AIアシスタント</h3>
        <div style={{ position: 'relative' }}>
          <div
            ref={aiOutputRef}
            style={{
              border: '1px solid #ddd',
              borderRadius: 6,
              padding: 12,
              height: aiOutputHeight,
              background: '#f0f8ff',
              overflowY: 'auto',
              overflowX: 'hidden'
            }}
          >
            <div style={{ display: 'grid', gap: 8 }}>
              {aiMessages.map((msg, i) => {
                if (msg.type === 'llm_call') {
                  // LLM呼び出しログ
                  let logData: any = {};
                  try {
                    logData = JSON.parse(msg.message);
                  } catch {}

                  return (
                    <details key={msg.timestamp + '-' + i} style={{ padding: 8, background: '#fff9e6', borderRadius: 4, borderLeft: '3px solid #f39c12' }}>
                      <summary style={{ cursor: 'pointer', fontSize: 12, color: '#666', marginBottom: 4 }}>
                        🔍 LLM Call - {new Date(msg.timestamp).toLocaleTimeString('ja-JP')} - Node: {logData.nodeId || 'default'}
                      </summary>
                      <div style={{ marginTop: 8, fontSize: 13 }}>
                        <div style={{ marginBottom: 8 }}>
                          <strong>Prompt:</strong>
                          <pre style={{ whiteSpace: 'pre-wrap', background: '#f5f5f5', padding: 8, borderRadius: 4, fontSize: 12, marginTop: 4 }}>
                            {logData.prompt || '(empty)'}
                          </pre>
                        </div>
                        <div>
                          <strong>Raw Response:</strong>
                          <pre style={{ whiteSpace: 'pre-wrap', background: '#f5f5f5', padding: 8, borderRadius: 4, fontSize: 12, marginTop: 4 }}>
                            {logData.rawResponse || '(empty)'}
                          </pre>
                        </div>
                      </div>
                    </details>
                  );
                } else {
                  // AI介入メッセージ
                  return (
                    <div key={msg.timestamp + '-' + i} style={{ padding: 8, background: '#e6f3ff', borderRadius: 4, borderLeft: '3px solid #2980b9' }}>
                      <div style={{ fontSize: 12, color: '#666', marginBottom: 4 }}>
                        {new Date(msg.timestamp).toLocaleTimeString('ja-JP')}
                      </div>
                      <div style={{ lineHeight: 1.5 }}>{msg.message}</div>
                    </div>
                  );
                }
              })}
              {aiMessages.length === 0 && (
                <div style={{ color: '#888' }}>AIアシスタントからのメッセージがここに表示される</div>
              )}
            </div>
          </div>
          <div
            onMouseDown={onResizeStart}
            style={{
              position: 'absolute',
              bottom: 0,
              right: 0,
              width: 20,
              height: 20,
              cursor: 'ns-resize',
              background: 'linear-gradient(135deg, transparent 50%, #999 50%)',
              borderBottomRightRadius: 6
            }}
          />
        </div>

        <h3>文字起こし（擬似リアルタイム）</h3>
        <div style={{ border: '1px solid #ddd', borderRadius: 6, padding: 12, minHeight: 120, background: '#fafafa' }}>
          <div style={{ display: 'grid', gap: 6 }}>
            {partialText && (
              <div style={{ color: '#555' }}>{partialText}<span style={{ opacity: 0.5 }}> ▋</span></div>
            )}
            {[...finalSegments].reverse().map((seg, i) => (
              <div key={seg.at + '-' + i} style={{ lineHeight: 1.5 }}>
                {resolveSpeakerLabel(seg) && <span style={{ color: '#2980b9', fontWeight: 600, marginRight: 8 }}>[{resolveSpeakerLabel(seg)}]</span>}
                {seg.text}
              </div>
            ))}
            {!partialText && finalSegments.length === 0 && (
              <div style={{ color: '#888' }}>ここに文字起こしが表示される（「文字起こし開始」を押して話してみてね）</div>
            )}
          </div>
        </div>

        <h3>オーケストレーター設定</h3>
        <div style={{ border: '1px solid #ddd', borderRadius: 6, padding: 12, background: '#fff9f0' }}>
          <div style={{ marginBottom: 8, color: '#666', fontSize: 14 }}>
            介入判断プロンプト（会議の直近発話に対してAIが判断する際の指示）:
          </div>
          <textarea
            value={promptEditing}
            onChange={(e) => setPromptEditing(e.target.value)}
            rows={4}
            style={{
              width: '100%',
              fontFamily: 'monospace',
              fontSize: 14,
              padding: 8,
              borderRadius: 4,
              border: '1px solid #ccc',
              resize: 'vertical'
            }}
            disabled={promptSaving}
          />
          <div style={{ display: 'flex', gap: 8, marginTop: 8, alignItems: 'center' }}>
            <button onClick={onSavePrompt} disabled={promptSaving || promptEditing === orchestratorPrompt}>
              {promptSaving ? '保存中...' : '保存'}
            </button>
            <button onClick={onResetPrompt} disabled={promptSaving || promptEditing === orchestratorPrompt}>
              リセット
            </button>
            {promptMessage && (
              <span style={{
                color: promptMessage.type === 'success' ? '#27ae60' : '#c0392b',
                fontSize: 14,
                marginLeft: 4
              }}>
                {promptMessage.text}
              </span>
            )}
          </div>
        </div>

        <h3>ログ</h3>
        <p style={{ color: '#666' }}>meetingId: {meetingId || '-'} <button onClick={() => navigator.clipboard?.writeText(meetingId)} disabled={!meetingId}>コピー</button></p>
        <p style={{ color: '#666' }}>attendeeId: {attendeeId || '-'}</p>
      </section>
    </div>
  );
}
