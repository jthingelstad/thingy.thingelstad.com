function speechInputCtor() {
  return window.SpeechRecognition || window.webkitSpeechRecognition || null;
}

interface DictationOptions {
  maxChars?: number;
  isBusy?: () => boolean;
  getText?: () => string;
  onText?: (value: string) => void;
  onStatus?: (value: string) => void;
  onListeningChange?: (value: boolean) => void;
  onTrack?: (name: string, value?: string) => void;
}

function createDictationController(options: DictationOptions = {}) {
  const maxChars = Number(options.maxChars || 1200);
  const isBusy = typeof options.isBusy === 'function' ? options.isBusy : () => false;
  const getText = typeof options.getText === 'function' ? options.getText : () => '';
  const onText = typeof options.onText === 'function' ? options.onText : () => {};
  const onStatus = typeof options.onStatus === 'function' ? options.onStatus : () => {};
  const onListeningChange = typeof options.onListeningChange === 'function' ? options.onListeningChange : () => {};
  const onTrack = typeof options.onTrack === 'function' ? options.onTrack : () => {};
  let recognition: ThingySpeechRecognition | null = null;
  let listening = false;
  let baseText = '';
  let finalText = '';

  function supported() {
    return Boolean(speechInputCtor());
  }

  function setStatus(message: string) {
    onStatus(message || '');
  }

  function setListening(value: boolean) {
    listening = value;
    onListeningChange(value);
  }

  function render(interim = '') {
    const parts = [baseText, finalText, interim].map((part) => String(part || '').trim()).filter(Boolean);
    onText(parts.join(' ').slice(0, maxChars));
  }

  function stop() {
    if (recognition) {
      try {
        recognition.stop();
      } catch (error) {
        /* ignore */
      }
    }
  }

  function start() {
    const Recognition = speechInputCtor();
    if (!Recognition) {
      setStatus('Speech input is not supported in this browser.');
      return;
    }
    if (listening) {
      stop();
      return;
    }
    if (isBusy()) {
      return;
    }
    recognition = new Recognition();
    baseText = getText().trim();
    finalText = '';
    setListening(true);
    setStatus('Listening...');
    recognition.lang = navigator.language || 'en-US';
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;
    recognition.onresult = (event) => {
      let interim = '';
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const result = event.results[i];
        const transcript = result[0]?.transcript || '';
        if (result.isFinal) {
          finalText = `${finalText} ${transcript}`.trim();
        } else {
          interim = `${interim} ${transcript}`.trim();
        }
      }
      render(interim);
    };
    recognition.onerror = (event) => {
      const kind = event.error || '';
      if (kind === 'not-allowed' || kind === 'service-not-allowed') {
        setStatus('Microphone access was blocked.');
      } else if (kind === 'no-speech') {
        setStatus('No speech detected.');
      } else {
        setStatus('Dictation stopped.');
      }
    };
    recognition.onend = () => {
      setListening(false);
      recognition = null;
      setStatus('');
    };
    try {
      recognition.start();
      onTrack('librarian.voice_input_start');
    } catch (error) {
      setListening(false);
      recognition = null;
      setStatus('Could not start dictation.');
      onTrack('librarian.voice_input_error', 'start');
    }
  }

  return {
    dispose: () => {
      stop();
      setListening(false);
    },
    isListening: () => listening,
    start,
    stop,
    supported
  };
}

function speechInputSupported() {
  return Boolean(speechInputCtor());
}

export { createDictationController, speechInputSupported };
