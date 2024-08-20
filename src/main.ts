import {
  Hume,
  HumeClient,
  convertBlobToBase64,
  convertBase64ToBlob,
  ensureSingleValidAudioTrack,
  getAudioStream,
  getBrowserSupportedMimeType,
  MimeType,
} from 'hume';
import './styles.css';

// Define the interfaces
interface Score {
  emotion: string;
  score: string;
}

interface ChatMessage {
  role: Hume.empathicVoice.Role;
  timestamp: string;
  content: string;
  scores: Score[];
}

declare global {
  interface HTMLElementTagNameMap {
    'dotlottie-player': HTMLLottiePlayerElement;
  }
}

interface HTMLLottiePlayerElement extends HTMLElement {
  play: () => void;
  pause: () => void;
}

(async () => {
  const startBtn = document.querySelector<HTMLButtonElement>('button#start-btn');
  const stopBtn = document.querySelector<HTMLButtonElement>('button#stop-btn');
  const showChatBtn = document.querySelector<HTMLButtonElement>('button#show-chat-btn');
  const chat = document.querySelector<HTMLDivElement>('div#chat');
  const loader = document.getElementById('loader');

  startBtn?.addEventListener('click', connect);
  stopBtn?.addEventListener('click', disconnect);

  // Initial state: chat messages hidden
  chat?.classList.add('d-none');

  showChatBtn?.addEventListener('click', () => {
    if (chat) {
      chat.classList.toggle('d-none');
      showChatBtn.textContent = chat.classList.contains('d-none') ? 'Show Chat' : 'Hide Chat';
    }
  });

  let client: HumeClient | null = null;
  let socket: Hume.empathicVoice.chat.ChatSocket | null = null;
  let connected = false;
  let recorder: MediaRecorder | null = null;
  let audioStream: MediaStream | null = null;
  let currentAudio: HTMLAudioElement | null = null;
  let isPlaying = false;
  let resumeChats = true;
  let chatGroupId: string | undefined;
  const audioQueue: Blob[] = [];
  const mimeType: MimeType = (() => {
    const result = getBrowserSupportedMimeType();
    return result.success ? result.mimeType : MimeType.WEBM;
  })();

  async function connect(): Promise<void> {
    try {
      loader?.classList.remove('d-none');
      toggleBtnStates(true);

      if (!client) {
        client = new HumeClient({
          apiKey: "AsXjOv5QplL9BRsGiW2u5EtHmspALxKWto6GHW0QWpm7Ea9H",
          secretKey: "GyHkghvn8wWGHRh08KVXYq9GKv3p2b6f74E6CcKGEYBeAHQ0ofT5pEVT5h6NxZLn",
        });
      }

      socket = await client.empathicVoice.chat.connect({
        configId: "30f4d010-7252-4778-bc5f-1e1de72b3e76",
        resumedChatGroupId: chatGroupId,
      });

      socket.on('open', handleWebSocketOpenEvent);
      socket.on('message', handleWebSocketMessageEvent);
      socket.on('error', handleWebSocketErrorEvent);
      socket.on('close', handleWebSocketCloseEvent);

      startLottieAnimation(); // Start animation when connected

    } catch (error) {
      console.error("Error connecting:", error);
      alert("Failed to connect to the chatbot. Please try again.");
      toggleBtnStates(false);
    } finally {
      loader?.classList.add('d-none');
    }
  }

  function disconnect(): void {
    toggleBtnStates(false);
    stopAudio();
    stopLottieAnimation(); // Stop and hide animation when disconnected
    recorder?.stop();
    recorder = null;
    audioStream = null;
    connected = false;
    if (!resumeChats) chatGroupId = undefined;
    socket?.close();
  }

  async function captureAudio(): Promise<void> {
    audioStream = await getAudioStream();
    ensureSingleValidAudioTrack(audioStream);
    recorder = new MediaRecorder(audioStream, { mimeType });
    recorder.ondataavailable = async ({ data }) => {
      if (data.size < 1) return;
      const encodedAudioData = await convertBlobToBase64(data);
      const audioInput: Omit<Hume.empathicVoice.AudioInput, 'type'> = { data: encodedAudioData };
      socket?.sendAudioInput(audioInput);
    };
    recorder.start(100);
  }

  function playAudio(): void {
    if (!audioQueue.length || isPlaying) return;
    isPlaying = true;
    const audioBlob = audioQueue.shift();
    if (!audioBlob) return;
    const audioUrl = URL.createObjectURL(audioBlob);
    currentAudio = new Audio(audioUrl);
    currentAudio.play();
    currentAudio.onended = () => {
      isPlaying = false;
      if (audioQueue.length) playAudio();
    };
  }

  function stopAudio(): void {
    currentAudio?.pause();
    currentAudio = null;
    isPlaying = false;
    audioQueue.length = 0;
  }

  async function handleWebSocketOpenEvent(): Promise<void> {
    console.log('Web socket connection opened');
    connected = true;
    await captureAudio();
  }

  async function handleWebSocketMessageEvent(message: Hume.empathicVoice.SubscribeEvent): Promise<void> {
    switch (message.type) {
      case 'chat_metadata':
        chatGroupId = message.chatGroupId;
        break;
      case 'user_message':
      case 'assistant_message':
        startLottieAnimation(); // Start animation when a message is received
        const { role, content } = message.message;
        const topThreeEmotions = extractTopThreeEmotions(message);
        appendMessage(role, content ?? '', topThreeEmotions);
        break;
      case 'audio_output':
        const audioOutput = message.data;
        const blob = convertBase64ToBlob(audioOutput, mimeType);
        audioQueue.push(blob);
        if (audioQueue.length >= 1) playAudio();
        break;
      case 'user_interruption':
        stopAudio();
        stopLottieAnimation(); // Stop animation when the conversation is interrupted
        break;
    }
  }

  function handleWebSocketErrorEvent(error: Error): void {
    console.error(error);
    alert("An error occurred with the WebSocket connection. Reconnecting...");
  }

  async function handleWebSocketCloseEvent(): Promise<void> {
    if (connected) await connect();
    console.log('Web socket connection closed');
  }

  function appendMessage(role: Hume.empathicVoice.Role, content: string, topThreeEmotions: { emotion: string; score: any }[]): void {
    const chatCard = new ChatCard({ role, timestamp: new Date().toLocaleTimeString(), content, scores: topThreeEmotions });
    chat?.appendChild(chatCard.render());
    if (chat && !chat.classList.contains('d-none')) {
      chat.scrollTop = chat.scrollHeight;
    }
  }

  function toggleBtnStates(disableStart = false): void {
    if (startBtn) startBtn.disabled = disableStart;
    if (stopBtn) stopBtn.disabled = !disableStart;
  }

  function extractTopThreeEmotions(message: Hume.empathicVoice.UserMessage | Hume.empathicVoice.AssistantMessage): { emotion: string; score: string }[] {
    const scores = message.models.prosody?.scores;
    const scoresArray = Object.entries(scores || {}).sort((a, b) => b[1] - a[1]);
    return scoresArray.slice(0, 3).map(([emotion, score]) => ({ emotion, score: (Math.round(Number(score) * 100) / 100).toFixed(2) }));
  }

  function startLottieAnimation(): void {
    const lottieContainer = document.getElementById('lottie-animation');
    lottieContainer?.classList.remove('d-none'); // Show the Lottie animation
    const lottiePlayer = lottieContainer?.querySelector('dotlottie-player') as HTMLLottiePlayerElement;
    lottiePlayer?.play();
  }

  function stopLottieAnimation(): void {
    const lottieContainer = document.getElementById('lottie-animation');
    lottieContainer?.classList.add('d-none'); // Hide the Lottie animation
    const lottiePlayer = lottieContainer?.querySelector('dotlottie-player') as HTMLLottiePlayerElement;
    lottiePlayer?.pause();
  }
})();

class ChatCard {
  private message: ChatMessage;

  constructor(message: ChatMessage) {
    this.message = message;
  }

  private createScoreItem(score: Score): HTMLElement {
    const scoreItem = document.createElement('div');
    scoreItem.className = 'score-item';
    scoreItem.innerHTML = `${score.emotion}: <strong>${score.score}</strong>`;
    return scoreItem;
  }

  public render(): HTMLElement {
    const card = document.createElement('div');
    card.className = `chat-card ${this.message.role}`;

    const role = document.createElement('div');
    role.className = 'role';
    role.textContent = this.message.role.charAt(0).toUpperCase() + this.message.role.slice(1);

    const timestamp = document.createElement('div');
    timestamp.innerHTML = `<strong>${this.message.timestamp}</strong>`;

    const content = document.createElement('div');
    content.className = 'content';
    content.textContent = this.message.content;

    const scores = document.createElement('div');
    scores.className = 'scores';
    this.message.scores.forEach((score) => scores.appendChild(this.createScoreItem(score)));

    card.appendChild(role);
    card.appendChild(timestamp);
    card.appendChild(content);
    card.appendChild(scores);

    return card;
  }
}
