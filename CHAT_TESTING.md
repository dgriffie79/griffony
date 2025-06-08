# Chat Testing Instructions

The basic chat functionality has been implemented as part of the multiplayer system. Here's how to test it:

## Setup

1. **Build the project:**
   ```bash
   npm run build
   npm run dev
   ```

2. **Open two browser tabs/windows** pointing to the dev server (usually `http://localhost:5173`)

## Testing Chat

### Step 1: Establish Connection
1. In the first tab, click "Host Game" in the main menu
2. Copy the generated offer string
3. In the second tab, click "Join Game" 
4. Paste the offer string and click "Create Answer"
5. Copy the answer string back to the first tab
6. Paste it and click "Process Answer"
7. Both tabs should now show "Connection established successfully"

### Step 2: Test Chat
1. In either tab, press **T** to open the chat
2. Type a message and press **Enter** to send
3. The message should appear in both tabs
4. Press **Escape** to close the chat input (messages will auto-hide after 10 seconds)

## Expected Behavior

- **Chat UI**: Bottom-left corner, dark semi-transparent background
- **Opening Chat**: Press 'T' key to open chat input
- **Sending Messages**: Type message and press Enter
- **Closing Chat**: Press Escape or send a message
- **Message Display**: Shows timestamp, player name, and message
- **Auto-hide**: Chat messages disappear after 10 seconds if not actively chatting
- **Input Prevention**: Game controls are disabled while chat is open

## Features

- **Real-time messaging** between connected players
- **Automatic message relay** (host forwards messages to all clients)
- **Timestamped messages** with player identification
- **Input isolation** (game controls disabled during chat)
- **Auto-hide interface** for clean gameplay
- **Message history** (up to 50 messages)

## Troubleshooting

- If chat doesn't open with 'T', check that the connection is established
- If messages don't appear on the other side, check browser console for networking errors
- Make sure both browsers support WebRTC (modern Chrome, Firefox, Edge, Safari)

## Technical Notes

- Uses native WebRTC DataChannels for low-latency messaging
- Chat messages have LOW priority in the message batching system
- Player names are currently auto-generated as `Player_[peerId]`
- Chat input is HTML-escaped to prevent XSS attacks
