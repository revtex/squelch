// Call data from WS CAL event or search results.

export interface Call {
  id: number;
  audioName: string;
  audioType: string;
  dateTime: number; // unix timestamp
  systemId: number; // radio system ID
  system: number; // DB system ID
  talkgroupId: number; // radio TG ID
  talkgroup: number; // DB TG ID
  frequency?: number; // Hz
  duration?: number; // ms
  source?: number; // unit ID
  sources?: string; // JSON array
  frequencies?: string; // JSON array
  patches?: string; // JSON array
  site?: string; // receiver site name
  channel?: string; // channel identifier
  decoder?: string; // decoder type (e.g. "P25 Phase 1")
  errorCount?: number; // P25 error count
  spikeCount?: number; // P25 spike count
  talkerAlias?: string; // DMR/P25 talker alias
  systemLabel?: string; // populated from config
  talkgroupLabel?: string; // populated from config
  talkgroupName?: string; // populated from config
  talkgroupTag?: string; // populated from config
  talkgroupGroup?: string; // populated from config
  talkgroupLedColor?: string; // CSS color for LED
  transcript?: string;
  transcriptSegments?: TranscriptionSegment[];
  audioUrl?: string; // object URL for audio playback
}

export interface TranscriptionSegment {
  speaker?: string;
  start: number;
  end: number;
  text: string;
}
