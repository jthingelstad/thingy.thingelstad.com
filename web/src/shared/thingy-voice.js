function speechInputCtor() {
  return window.SpeechRecognition || window.webkitSpeechRecognition || null;
}

function createDictationController(options = {}) {
  const input = options.input || null;
  const button = options.button || null;
  const status = options.status || null;
  const maxChars = Number(options.maxChars || input?.getAttribute('maxlength') || 1200);
  const isBusy = typeof options.isBusy === 'function' ? options.isBusy : () => false;
  const onInput = typeof options.onInput === 'function' ? options.onInput : () => {};
  const onTrack = typeof options.onTrack === 'function' ? options.onTrack : () => {};
  let recognition = null;
  let listening = false;
  let baseText = '';
  let finalText = '';

  function supported() {
    return Boolean(speechInputCtor());
  }

  function setStatus(message) {
    if (status) status.textContent = message || '';
  }

  function updateButtonState() {
    if (!button) return;
    const canUse = supported();
    const busy = isBusy();
    button.disabled = !canUse || (busy && !listening);
    button.classList.toggle('is-listening', listening);
    button.setAttribute('aria-pressed', listening ? 'true' : 'false');
    if (!canUse) {
      button.title = 'Speech input not supported in this browser';
      button.setAttribute('aria-label', 'Speech input not supported');
    } else if (listening) {
      button.title = 'Stop dictation';
      button.setAttribute('aria-label', 'Stop dictation');
    } else {
      button.title = 'Dictate prompt';
      button.setAttribute('aria-label', 'Dictate prompt');
    }
  }

  function render(interim = '') {
    if (!input) return;
    const parts = [baseText, finalText, interim].map((part) => String(part || '').trim()).filter(Boolean);
    input.value = parts.join(' ').slice(0, maxChars);
    onInput();
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
    if (!input) return;
    const Recognition = speechInputCtor();
    if (!Recognition) {
      setStatus('Speech input is not supported in this browser.');
      updateButtonState();
      return;
    }
    if (listening) {
      stop();
      return;
    }
    if (isBusy()) {
      updateButtonState();
      return;
    }
    recognition = new Recognition();
    baseText = input.value.trim();
    finalText = '';
    listening = true;
    setStatus('Listening...');
    updateButtonState();
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
      listening = false;
      recognition = null;
      if (status && status.textContent === 'Listening...') setStatus('');
      updateButtonState();
    };
    try {
      recognition.start();
      onTrack('librarian.voice_input_start');
    } catch (error) {
      listening = false;
      recognition = null;
      setStatus('Could not start dictation.');
      updateButtonState();
      onTrack('librarian.voice_input_error', 'start');
    }
  }

  if (button) button.addEventListener('click', start);

  return {
    isListening: () => listening,
    start,
    stop,
    supported,
    updateButtonState
  };
}

function speechInputSupported() {
  return Boolean(speechInputCtor());
}

export { createDictationController, speechInputSupported };
