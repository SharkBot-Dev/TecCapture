(() => {
  "use strict";

  const DEFAULT_OPTIONS = {
    skill: "javascript",
    challenge: null,
    flaskApiUrl: null,
    flaskMethod: "GET",
    verifyApiUrl: null,
    verifyMethod: "POST",
    checkboxText: null,
    loadingText: "ロード中です...",
    verifyingText: "回答をチェック中...",
    loadFailedText: "取得に失敗しました。",
    submitBlockedText: "取得に失敗しました。",
    correctText: "フォームを送信できます。",
    incorrectText: "もう一度やり直してください。",
    showHintText: "ヒントを表示",
    verifyButtonText: "認証",
    autoDisableSubmit: true,
    hiddenInputName: "tec_capture_verified",
    sessionInputName: "tec_capture_session_id",
  };

  class TecCapture {
    constructor(form, options = {}) {
      if (!(form instanceof HTMLFormElement)) {
        throw new TypeError("TecCapture requires a form element.");
      }

      const datasetChallenge = getDatasetChallenge(form);

      this.form = form;
      this.options = {
        ...DEFAULT_OPTIONS,
        skill: form.dataset.skill || DEFAULT_OPTIONS.skill,
        flaskApiUrl:
          form.dataset.flaskApiUrl ||
          form.dataset.sourceUrl ||
          DEFAULT_OPTIONS.flaskApiUrl,
        flaskMethod: form.dataset.flaskMethod || DEFAULT_OPTIONS.flaskMethod,
        verifyApiUrl:
          form.dataset.verifyApiUrl ||
          form.dataset.flaskVerifyUrl ||
          DEFAULT_OPTIONS.verifyApiUrl,
        verifyMethod: form.dataset.verifyMethod || DEFAULT_OPTIONS.verifyMethod,
        challenge: datasetChallenge,
        ...options,
      };

      this.challenge = normalizeChallenge(this.options, this.options.challenge);
      this.selectedAnswer = "";
      this.verified = false;
      this.originalSubmitDisabled = new Map();

      this.mount();
      this.loadFlaskChallenge();
    }

    mount() {
      injectStyles();

      this.root = document.createElement("div");
      this.root.className = "tec-capture";

      this.checkboxId = uniqueId("tec-capture-check");
      this.answerId = uniqueId("tec-capture-answer");
      this.imageId = uniqueId("tec-capture-image");

      const checkboxText =
        this.options.checkboxText ||
        `私は${this.challenge.label}のスキルがあります。`;

      this.root.innerHTML = `
        <label class="tec-capture__claim" for="${this.checkboxId}">
          <input id="${this.checkboxId}" class="tec-capture__checkbox" type="checkbox" />
          <span>${escapeHtml(checkboxText)}</span>
        </label>
        <div class="tec-capture__challenge" hidden>
          <p class="tec-capture__question"></p>
          <img id="${this.imageId}" class="tec-capture__image" alt="Technical challenge" hidden />
          <div class="tec-capture__choices" role="radiogroup" aria-label="Answer choices"></div>
          <div class="tec-capture__answer-row">
            <input
              id="${this.answerId}"
              class="tec-capture__answer"
              type="text"
              autocomplete="off"
              spellcheck="false"
            />
            <button class="tec-capture__verify" type="button">
              ${escapeHtml(this.options.verifyButtonText)}
            </button>
          </div>
          <button class="tec-capture__hint-button" type="button">
            ${escapeHtml(this.options.showHintText)}
          </button>
          <p class="tec-capture__hint" hidden></p>
          <p class="tec-capture__message" aria-live="polite"></p>
        </div>
      `;

      this.hiddenInput = document.createElement("input");
      this.hiddenInput.type = "hidden";
      this.hiddenInput.name = this.options.hiddenInputName;
      this.hiddenInput.value = "false";

      this.sessionInput = document.createElement("input");
      this.sessionInput.type = "hidden";
      this.sessionInput.name = this.options.sessionInputName;
      this.sessionInput.value = "";

      this.form.append(this.root, this.hiddenInput, this.sessionInput);
      this.cacheElements();
      this.bindEvents();
      this.renderChallenge();

      if (this.options.autoDisableSubmit) {
        this.setSubmitDisabled(true);
      }
    }

    cacheElements() {
      this.checkbox = this.root.querySelector(".tec-capture__checkbox");
      this.challengeBox = this.root.querySelector(".tec-capture__challenge");
      this.questionLabel = this.root.querySelector(".tec-capture__question");
      this.challengeImage = this.root.querySelector(".tec-capture__image");
      this.choicesBox = this.root.querySelector(".tec-capture__choices");
      this.answerInput = this.root.querySelector(".tec-capture__answer");
      this.verifyButton = this.root.querySelector(".tec-capture__verify");
      this.hintButton = this.root.querySelector(".tec-capture__hint-button");
      this.hint = this.root.querySelector(".tec-capture__hint");
      this.message = this.root.querySelector(".tec-capture__message");
      this.submitButtons = Array.from(
        this.form.querySelectorAll('button[type="submit"], input[type="submit"]')
      );
    }

    bindEvents() {
      this.checkbox.addEventListener("change", () => {
        this.resetVerification();
        this.challengeBox.hidden = !this.checkbox.checked;
        this.setSubmitDisabled(true);

        if (this.checkbox.checked) {
          this.focusAnswer();
        }
      });

      this.answerInput.addEventListener("input", () => {
        this.selectedAnswer = this.answerInput.value;
        this.clearSelectedChoice();
      });

      this.answerInput.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          this.verify();
        }
      });

      this.verifyButton.addEventListener("click", () => this.verify());

      this.hintButton.addEventListener("click", () => {
        this.hint.hidden = !this.hint.hidden;
      });

      this.form.addEventListener("submit", (event) => {
        if (!this.verified) {
          event.preventDefault();
          this.message.textContent = this.options.submitBlockedText;
          this.message.className = "tec-capture__message tec-capture__message--error";
          this.focusAnswer();
        }
      });
    }

    async loadFlaskChallenge() {
      if (this.options.challenge || !this.options.flaskApiUrl) {
        return;
      }

      this.setLoading(true, this.options.loadingText);

      try {
        const flaskChallenge = await fetchFlaskChallenge(this.options);
        this.challenge = normalizeChallenge(this.options, flaskChallenge);
        this.resetVerification();
        this.renderChallenge();
      } catch (error) {
        this.message.textContent = this.options.loadFailedText;
        this.message.className = "tec-capture__message tec-capture__message--error";
      } finally {
        this.setLoading(false);
      }
    }

    renderChallenge() {
      this.questionLabel.textContent = this.challenge.question;
      this.answerInput.placeholder = this.challenge.placeholder || "";
      this.hint.textContent = this.challenge.hint || "";
      this.hintButton.hidden = !this.challenge.hint;
      this.sessionInput.value = this.challenge.sessionId || "";
      this.renderImage();
      this.renderChoices();
    }

    renderImage() {
      const imageSource = this.challenge.image || this.challenge.imageUrl || this.challenge.imageData;

      if (!imageSource) {
        this.challengeImage.hidden = true;
        this.challengeImage.removeAttribute("src");
        return;
      }

      this.challengeImage.src = normalizeImageSource(imageSource);
      this.challengeImage.hidden = false;
    }

    renderChoices() {
      this.choicesBox.textContent = "";
      const choices = this.challenge.choices || [];
      this.choicesBox.hidden = choices.length === 0;
      this.answerInput.hidden = choices.length > 0;

      choices.forEach((choice) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "tec-capture__choice";
        button.textContent = choice;
        button.setAttribute("role", "radio");
        button.setAttribute("aria-checked", "false");
        button.addEventListener("click", () => {
          this.selectedAnswer = choice;
          this.answerInput.value = choice;
          this.clearSelectedChoice();
          button.classList.add("tec-capture__choice--selected");
          button.setAttribute("aria-checked", "true");
        });
        this.choicesBox.append(button);
      });
    }

    clearSelectedChoice() {
      this.choicesBox.querySelectorAll(".tec-capture__choice").forEach((button) => {
        button.classList.remove("tec-capture__choice--selected");
        button.setAttribute("aria-checked", "false");
      });
    }

    resetVerification() {
      this.selectedAnswer = "";
      this.verified = false;
      this.hiddenInput.value = "false";
      this.sessionInput.value = this.challenge.sessionId || "";
      this.message.textContent = "";
      this.message.className = "tec-capture__message";
      this.answerInput.value = "";
      this.hint.hidden = true;
      this.clearSelectedChoice();
    }

    setLoading(isLoading, text = "") {
      this.answerInput.disabled = isLoading;
      this.verifyButton.disabled = isLoading;
      this.choicesBox.querySelectorAll("button").forEach((button) => {
        button.disabled = isLoading;
      });

      if (isLoading && text) {
        this.message.textContent = text;
        this.message.className = "tec-capture__message";
      }
    }

    focusAnswer() {
      const firstChoice = this.choicesBox.querySelector("button");

      if (firstChoice && !this.choicesBox.hidden) {
        firstChoice.focus();
        return;
      }

      this.answerInput.focus();
    }

    async verify() {
      const answer = this.selectedAnswer || this.answerInput.value;

      if (!answer.trim()) {
        this.message.textContent = this.options.incorrectText;
        this.message.className = "tec-capture__message tec-capture__message--error";

        setTimeout(() => {
            this.loadFlaskChallenge();
        }, 2000);

        return false;
      }

      this.setLoading(true, this.options.verifyingText);

      try {
        const isCorrect = this.challenge.sessionId
          ? await verifyFlaskAnswer(this.options, this.challenge.sessionId, answer)
          : verifyLocalAnswer(this.challenge, answer);

        this.verified = Boolean(isCorrect);
        this.hiddenInput.value = this.verified ? "true" : "false";

        if (this.verified) {
          this.message.textContent = this.options.correctText;
          this.message.className = "tec-capture__message tec-capture__message--success";
          this.setSubmitDisabled(false);
          return true;
        }

        this.message.textContent = this.options.incorrectText;
        this.message.className = "tec-capture__message tec-capture__message--error";
        this.setSubmitDisabled(true);

        setTimeout(() => {
            this.loadFlaskChallenge();
        }, 2000);

        return false;
      } catch (error) {
        this.message.textContent = this.options.incorrectText;
        this.message.className = "tec-capture__message tec-capture__message--error";
        this.setSubmitDisabled(true);

        setTimeout(() => {
            this.loadFlaskChallenge();
        }, 2000);

        return false;
      } finally {
        this.setLoading(false);
      }
    }

    setSubmitDisabled(disabled) {
      if (!this.options.autoDisableSubmit) {
        return;
      }

      this.submitButtons.forEach((button) => {
        if (!this.originalSubmitDisabled.has(button)) {
          this.originalSubmitDisabled.set(button, button.disabled);
        }

        const wasOriginallyDisabled = this.originalSubmitDisabled.get(button);
        button.disabled = disabled || wasOriginallyDisabled;
      });
    }
  }

  async function fetchFlaskChallenge(options) {
    const url = new URL(options.flaskApiUrl, window.location.href);
    const request = buildJsonRequest(options.flaskMethod, { skill: options.skill }, url);
    const response = await fetch(url.toString(), request);

    if (!response.ok) {
      throw new Error(`Flask challenge API returned ${response.status}`);
    }

    const payload = await response.json();
    const challenge = Array.isArray(payload)
      ? payload[Math.floor(Math.random() * payload.length)]
      : payload.question || payload.image || payload.sessionId || payload.session_id
        ? payload
        : Array.isArray(payload.questions)
          ? payload.questions[Math.floor(Math.random() * payload.questions.length)]
          : null;

    if (!challenge) {
      throw new Error("Flask challenge API did not return a usable challenge.");
    }

    return challenge;
  }

  async function verifyFlaskAnswer(options, sessionId, answer) {
    const endpoint = options.verifyApiUrl || options.flaskApiUrl;
    const url = new URL(endpoint, window.location.href);
    const body = {
      skill: options.skill,
      sessionId,
      session_id: sessionId,
      answer,
    };
    const request = buildJsonRequest(options.verifyMethod, body, url);
    const response = await fetch(url.toString(), request);

    if (!response.ok) {
      throw new Error(`Flask verify API returned ${response.status}`);
    }

    const payload = await response.json();
    return parseVerificationResult(payload);
  }

  function buildJsonRequest(methodValue, body, url) {
    const method = String(methodValue || "POST").toUpperCase();
    const request = {
      headers: { Accept: "application/json" },
      cache: "no-store",
      credentials: "same-origin",
      method,
    };

    if (method === "GET") {
      Object.entries(body).forEach(([key, value]) => {
        url.searchParams.set(key, value);
      });
    } else {
      request.headers["Content-Type"] = "application/json";
      request.body = JSON.stringify(body);
    }

    return request;
  }

  function parseVerificationResult(payload) {
    if (typeof payload === "boolean") {
      return payload;
    }

    if (typeof payload.correct === "boolean") {
      return payload.correct;
    }

    if (typeof payload.ok === "boolean") {
      return payload.ok;
    }

    if (typeof payload.result === "string") {
      return payload.result.toLowerCase() === "correct";
    }

    return false;
  }

  function normalizeChallenge(options, candidate) {
    const skillKey = String(options.skill || "").toLowerCase();
    const challenge = candidate || getGenericFallback(options);
    const sessionId = challenge.sessionId || challenge.session_id || challenge.id || "";
    const hasServerSession = Boolean(sessionId);

    return {
      label: challenge.label || options.skill,
      question: challenge.question || "Select the correct answer shown in the image.",
      placeholder: challenge.placeholder || "",
      hint: challenge.hint || "",
      image: challenge.image || challenge.image_url || challenge.imageUrl || challenge.imageData,
      sessionId,
      choices: normalizeChoices(challenge),
      answers: hasServerSession ? [] : normalizeAnswers(challenge),
      validate: hasServerSession ? null : challenge.validate,
      source: challenge.source || (hasServerSession ? "flask" : "local"),
    };
  }

  function normalizeChoices(challenge) {
    const choices =
      challenge.choices ||
      challenge.options ||
      challenge.answers ||
      challenge.mixedAnswers ||
      challenge.mixed_answers ||
      [];

    return Array.isArray(choices) ? choices.map(String) : [];
  }

  function normalizeAnswers(challenge) {
    if (Array.isArray(challenge.correctAnswers)) {
      return challenge.correctAnswers.map(String);
    }

    if (Array.isArray(challenge.acceptedAnswers)) {
      return challenge.acceptedAnswers.map(String);
    }

    if (typeof challenge.answer === "string") {
      return [challenge.answer];
    }

    return [];
  }

  function verifyLocalAnswer(challenge, answer) {
    const normalizedAnswer = normalizeText(answer);

    if (typeof challenge.validate === "function") {
      return challenge.validate(normalizedAnswer);
    }

    return challenge.answers.some((expected) => normalizeText(expected) === normalizedAnswer);
  }

  function getGenericFallback(options) {
    return {
      label: options.skill,
      question: `Type the exact technology name "${options.skill}" to continue.`,
      placeholder: options.skill,
      answers: [options.skill],
      hint: "なし",
      source: "fallback",
    };
  }

  function getDatasetChallenge(form) {
    if (!form.dataset.question && !form.dataset.answer) {
      return null;
    }

    if (!form.dataset.question || !form.dataset.answer) {
      throw new Error("data-question and data-answer must be used together.");
    }

    return {
      label: form.dataset.skillLabel || form.dataset.skill || DEFAULT_OPTIONS.skill,
      question: form.dataset.question,
      placeholder: form.dataset.placeholder || "",
      hint: form.dataset.hint || "",
      answers: form.dataset.answer.split("|").map((answer) => answer.trim()),
    };
  }

  function initAll() {
    document.querySelectorAll("form[data-tec-capture]").forEach((form) => {
      if (!form.tecCapture) {
        form.tecCapture = new TecCapture(form);
      }
    });
  }

  function normalizeImageSource(value) {
    const source = String(value);

    if (/^(https?:|data:|blob:|\/)/i.test(source)) {
      return source;
    }

    return `data:image/png;base64,${source}`;
  }

  function uniqueId(prefix) {
    return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
  }

  function normalizeText(value) {
    return String(value).trim().toLowerCase().replace(/\s+/g, " ");
  }

  function escapeHtml(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function injectStyles() {
    if (document.getElementById("tec-capture-styles")) {
      return;
    }

    const style = document.createElement("style");
    style.id = "tec-capture-styles";
    style.textContent = `
      .tec-capture {
        border: 1px solid #d0d7de;
        border-radius: 8px;
        margin: 16px 0;
        padding: 14px;
        font: 14px/1.45 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }

      .tec-capture__claim {
        align-items: center;
        cursor: pointer;
        display: flex;
        gap: 8px;
      }

      .tec-capture__challenge {
        margin-top: 12px;
      }

      .tec-capture__question {
        font-weight: 600;
        margin: 0 0 8px;
      }

      .tec-capture__image {
        border: 1px solid #d0d7de;
        border-radius: 6px;
        display: block;
        margin: 8px 0;
        max-height: 220px;
        max-width: 100%;
      }

      .tec-capture__choices {
        display: grid;
        gap: 8px;
        grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
        margin: 8px 0;
      }

      .tec-capture__choice {
        background: #ffffff;
        border: 1px solid #8c959f;
        border-radius: 6px;
        cursor: pointer;
        padding: 8px 10px;
        text-align: left;
      }

      .tec-capture__choice--selected {
        background: #ddf4ff;
        border-color: #0969da;
      }

      .tec-capture__answer-row {
        display: flex;
        gap: 8px;
      }

      .tec-capture__answer {
        border: 1px solid #8c959f;
        border-radius: 6px;
        flex: 1;
        min-width: 0;
        padding: 8px 10px;
      }

      .tec-capture__verify,
      .tec-capture__hint-button {
        border: 1px solid #8c959f;
        border-radius: 6px;
        cursor: pointer;
        padding: 8px 12px;
      }

      .tec-capture__verify {
        background: #1f883d;
        border-color: #1f883d;
        color: #ffffff;
      }

      .tec-capture__verify:disabled,
      .tec-capture__answer:disabled,
      .tec-capture__choice:disabled {
        cursor: wait;
        opacity: 0.7;
      }

      .tec-capture__hint-button {
        background: #ffffff;
        margin-top: 8px;
      }

      .tec-capture__hint,
      .tec-capture__message {
        margin: 8px 0 0;
      }

      .tec-capture__message--success {
        color: #1a7f37;
      }

      .tec-capture__message--error {
        color: #cf222e;
      }

      @media (max-width: 520px) {
        .tec-capture__answer-row {
          flex-direction: column;
        }
      }
    `;
    document.head.append(style);
  }

  window.TecCapture = {
    create: (form, options) => new TecCapture(form, options),
    challenges: [],
    initAll,
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initAll);
  } else {
    initAll();
  }
})();
