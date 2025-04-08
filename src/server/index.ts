import express from "express";
import { createServer } from "http";
import { Server, Socket } from "socket.io";
import { parseBuffer } from "music-metadata";
import { config } from "dotenv";
config();

// Constants
const PORT = process.env.PORT || 3000;
const R2_BASE_URL = process.env.R2_BASE_URL;
const ALLOWED_ORIGINS = (
  process.env.ALLOWED_ORIGINS || "http://localhost:5173"
).split(",");

const PLAYLIST = [
  `${R2_BASE_URL}/1.mp3`,
  `${R2_BASE_URL}/2.mp3`,
  `${R2_BASE_URL}/3.mp3`,
] as const;

// Types
interface PlaybackState {
  currentTrack: string;
  isPlaying: boolean;
  startTime: number;
  currentPosition: number;
  playlist: readonly string[];
  currentTrackIndex: number;
  trackDurations: Record<string, number>;
}

// Initialize Express and Socket.IO
const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: ALLOWED_ORIGINS,
    methods: ["GET", "POST"],
  },
});

// Initialize playback state
let playbackState: PlaybackState = {
  currentTrack: PLAYLIST[0],
  isPlaying: true,
  startTime: Date.now(),
  currentPosition: 0,
  playlist: PLAYLIST,
  currentTrackIndex: 0,
  trackDurations: {},
};

async function getMP3Duration(url: string): Promise<number> {
  try {
    const response = await fetch(url);
    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const metadata = await parseBuffer(buffer);
    const duration = metadata.format.duration;

    if (!duration) {
      console.warn(`No duration found for ${url}, using default 2 seconds`);
      return 2;
    }

    return duration;
  } catch (error) {
    console.error(`Error getting duration for ${url}:`, error);
    return 2;
  }
}

async function initializeTrackDurations(): Promise<void> {
  console.log("Initializing track durations...");

  for (const track of PLAYLIST) {
    const duration = await getMP3Duration(track);
    playbackState.trackDurations[track] = duration;
    console.log(`Track duration: ${track} -> ${duration.toFixed(2)} seconds`);
  }

  console.log("Track durations initialized");
}

function updatePlaybackState(): void {
  if (!playbackState.isPlaying) return;

  playbackState.currentPosition = (Date.now() - playbackState.startTime) / 1000;
  const currentTrackDuration =
    playbackState.trackDurations[playbackState.currentTrack] || 2;

  if (playbackState.currentPosition >= currentTrackDuration) {
    // Move to next track
    playbackState.currentTrackIndex =
      (playbackState.currentTrackIndex + 1) % PLAYLIST.length;
    playbackState.currentTrack = PLAYLIST[playbackState.currentTrackIndex];
    playbackState.startTime = Date.now();
    playbackState.currentPosition = 0;

    console.log(`Switching to track: ${playbackState.currentTrack}`);

    // Notify all clients
    io.emit("playbackState", {
      ...playbackState,
      serverTime: Date.now(),
    });
  }
}

// Socket.IO event handlers
function handleSocketConnection(socket: Socket): void {
  console.log("New client connected");

  // Send current state to new client
  socket.emit("playbackState", {
    ...playbackState,
    serverTime: Date.now(),
  });

  socket.on("togglePlay", () => {
    playbackState.isPlaying = !playbackState.isPlaying;
    if (playbackState.isPlaying) {
      playbackState.startTime =
        Date.now() - playbackState.currentPosition * 1000;
    }
    io.emit("playbackState", {
      ...playbackState,
      serverTime: Date.now(),
    });
  });

  socket.on("disconnect", () => {
    console.log("Client disconnected");
  });
}

// Add a route to check the server state
app.get("/status", (req, res) => {
  res.json({
    status: "ok",
    currentTrack: playbackState.currentTrack,
    isPlaying: playbackState.isPlaying,
    currentPosition: playbackState.currentPosition,
    serverTime: Date.now(),
  });
});

// Start the server
async function startServer(): Promise<void> {
  try {
    // Initialize track durations
    await initializeTrackDurations();

    // Set up playback state updates
    setInterval(updatePlaybackState, 100);

    // Set up Socket.IO
    io.on("connection", handleSocketConnection);

    // Start HTTP server
    httpServer.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
    });
  } catch (error) {
    console.error("Failed to start server:", error);
    process.exit(1);
  }
}

// Start the server
startServer().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
