// @ts-check
/**
 * Tunnel de réservation /reserver (§7.2) : 4 étapes dans une seule page, sans rechargement.
 * Toutes les données passent par le formulaire (FormData) ; le serveur revalide tout.
 * Bouton « retour » du navigateur : revient à l'étape précédente (history.pushState).
 */
import { initCommon } from '../common.js';
import {
  addMonths,
  createCalendar,
  dayLabel,
  monthEnd,
  monthLabel,
} from '../components/booking-calendar.js';

initCommon();

/**
 * @typedef {{ id: number, label: string, price: number, extraMinutes: number }} Option
 * @typedef {{ slug: string, name: string, category: string|null, durationMin: number, durationMax: number, price: number|null, priceFrom: boolean, onQuote: boolean, bookable: boolean, allergyTest: boolean, options: Option[] }} Service
 * @typedef {{ services: Service[], today: string, lastDate: string, cancellationHours: number, manualValidation: boolean, maxPhotoBytes: number }} BookingData
 * @typedef {{ startsAt: string, endsAt: string }} Slot
 */

const euro = new Intl.NumberFormat('fr-FR', {
  style: 'currency',
  currency: 'EUR',
  maximumFractionDigits: 0,
});
const timeFormat = new Intl.DateTimeFormat('fr-FR', {
  hour: 'numeric',
  minute: '2-digit',
  timeZone: 'Europe/Paris',
});
const parisDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' });

/** « 9h », « 14h30 » @param {string} iso */
const formatTime = (iso) => {
  const [h, m] = timeFormat.format(new Date(iso)).split(':');
  return `${Number(h)}h${m === '00' ? '' : m}`;
};
/** 90 → « 1 h 30 » @param {number} minutes */
const formatMinutes = (minutes) => {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (!h) return `${m}\u00a0min`;
  return m ? `${h}\u00a0h\u00a0${String(m).padStart(2, '0')}` : `${h}\u00a0h`;
};
/** @param {number} min @param {number} max */
const formatDuration = (min, max) => {
  if (min === max) return formatMinutes(min);
  if (min % 60 === 0 && max % 60 === 0) return `${min / 60}\u00a0–\u00a0${max / 60}\u00a0h`;
  return `${formatMinutes(min)}\u00a0–\u00a0${formatMinutes(max)}`;
};
/** @param {string} value */
const escapeHtml = (value) => value.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * Preuve de travail anti-robot (voir src/server/modules/booking/anti-bot.js) : on cherche n tel
 * que SHA-256(sel + n) = défi. Calculé en arrière-plan pendant que la cliente remplit l'étape 3.
 */
async function solveChallenge() {
  const res = await fetch('/api/booking/challenge', { headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error('challenge');
  const c = await res.json();
  const encoder = new TextEncoder();
  // Calculs lancés par lots en parallèle : bien plus rapide qu'un await par essai.
  const BATCH = 1000;
  for (let start = 0; start <= c.maxNumber; start += BATCH) {
    const numbers = Array.from(
      { length: Math.min(BATCH, c.maxNumber - start + 1) },
      (_, i) => start + i,
    );
    const digests = await Promise.all(
      numbers.map((n) => crypto.subtle.digest('SHA-256', encoder.encode(c.salt + n))),
    );
    const index = digests.findIndex(
      (d) =>
        Array.from(new Uint8Array(d), (b) => b.toString(16).padStart(2, '0')).join('') ===
        c.challenge,
    );
    if (index >= 0) {
      const { algorithm, challenge, salt, signature } = c;
      return btoa(
        JSON.stringify({ algorithm, challenge, salt, signature, number: numbers[index] }),
      );
    }
  }
  throw new Error('unsolved');
}

/** @param {HTMLElement} root */
function initBooking(root) {
  /** @type {BookingData} */
  const data = JSON.parse(
    /** @type {HTMLElement} */ (document.getElementById('booking-data')).textContent ?? '{}',
  );
  const form = /** @type {HTMLFormElement} */ (root.querySelector('#booking-form'));
  const steps = /** @type {HTMLElement[]} */ ([...root.querySelectorAll('[data-step]')]);
  const $ = (/** @type {string} */ sel, scope = /** @type {ParentNode} */ (root)) =>
    /** @type {HTMLElement} */ (scope.querySelector(sel));

  const state = {
    step: 1,
    /** @type {Service|null} */
    service: null,
    /** @type {Option[]} */
    options: [],
    /** @type {string} */
    month: data.today.slice(0, 7),
    /** @type {Map<string, Slot[]>} */
    days: new Map(),
    /** @type {Slot|null} */
    slot: null,
    done: false,
    /** @type {Promise<string>|null} */
    solution: null,
    /** @type {AbortController|null} */
    loading: null,
  };

  // ─── Navigation entre étapes ────────────────────────────────────────────────
  /** @param {number} n @param {{ push?: boolean, focus?: boolean }} [opts] */
  function goTo(n, { push = true, focus = true } = {}) {
    state.step = n;
    root.dataset.stepCurrent = String(n);
    steps.forEach((s) => {
      s.hidden = s.dataset.step !== String(n);
    });
    root.querySelectorAll('[data-progress-item]').forEach((item) => {
      const i = Number(/** @type {HTMLElement} */ (item).dataset.progressItem);
      item.classList.toggle('is-current', i === n);
      item.classList.toggle('is-done', i < n);
      if (i === n) item.setAttribute('aria-current', 'step');
      else item.removeAttribute('aria-current');
    });
    if (push) history.pushState({ bookingStep: n }, '', `#etape-${n}`);
    if (n === 2) enterSlots();
    if (n >= 2 && !state.solution) {
      state.solution = solveChallenge();
      state.solution.catch(() => {
        state.solution = null;
      });
    }
    if (focus) {
      const title = $(`#etape-${n}-titre`);
      root.scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth', block: 'start' });
      title.focus({ preventScroll: true });
    }
  }

  window.addEventListener('popstate', (event) => {
    const target = Number(event.state?.bookingStep ?? 1);
    if (state.done) {
      // Rendez-vous confirmé : on ne revient pas dans un formulaire déjà envoyé.
      history.pushState({ bookingStep: 4 }, '', '#etape-4');
      return;
    }
    goTo(Math.min(target, maxReachableStep()), { push: false });
  });

  function maxReachableStep() {
    if (!state.service) return 1;
    if (!state.slot) return 2;
    return 3;
  }

  /** @param {number} n @param {string} message */
  function stepError(n, message) {
    const el = $(`[data-step="${n}"] [data-step-error]`);
    el.textContent = message;
  }

  root.querySelectorAll('[data-next]').forEach((button) =>
    button.addEventListener('click', () => {
      if (state.step === 1) {
        if (!state.service) return stepError(1, 'Choisissez une prestation pour continuer.');
        stepError(1, '');
        return goTo(2);
      }
      if (state.step === 2) {
        if (!state.slot) return stepError(2, 'Choisissez un jour puis un horaire pour continuer.');
        stepError(2, '');
        return goTo(3);
      }
    }),
  );
  root
    .querySelectorAll('[data-back]')
    .forEach((button) => button.addEventListener('click', () => history.back()));

  // ─── Étape 1 : prestation et options ───────────────────────────────────────
  const optionsBox = $('[data-options]');
  const optionsList = $('[data-options-list]');
  const allergyNote = $('[data-allergy]');

  function renderOptions() {
    const s = state.service;
    optionsBox.hidden = !s || s.options.length === 0;
    allergyNote.hidden = !s?.allergyTest;
    if (!s) return;
    optionsList.innerHTML = s.options
      .map((o) => {
        const extra = [
          o.price ? `+${euro.format(o.price)}` : '',
          o.extraMinutes ? `+${formatMinutes(o.extraMinutes)}` : '',
        ]
          .filter(Boolean)
          .join(' · ');
        return `<label class="option-choice"><input type="checkbox" name="options" value="${o.id}" /><span>${escapeHtml(o.label)}</span><span class="option-choice__price num">${extra}</span></label>`;
      })
      .join('');
  }

  /** Réinitialise le créneau : la durée a changé, les disponibilités aussi. */
  function resetSlot() {
    state.slot = null;
    state.days.clear();
    calendar.clearSelection();
    form.querySelectorAll('input[name="startsAt"]').forEach((input) => input.remove());
    $('[data-slots]').hidden = true;
  }

  form.addEventListener('change', (event) => {
    const input = /** @type {HTMLInputElement} */ (event.target);
    if (input.name === 'service') {
      state.service = data.services.find((s) => s.slug === input.value) ?? null;
      state.options = [];
      renderOptions();
      resetSlot();
      stepError(1, '');
    } else if (input.name === 'options' && state.service) {
      const ids = [...form.querySelectorAll('input[name="options"]:checked')].map((el) =>
        Number(/** @type {HTMLInputElement} */ (el).value),
      );
      state.options = state.service.options.filter((o) => ids.includes(o.id));
      resetSlot();
    } else if (input.name === 'startsAt') {
      state.slot = { startsAt: input.value, endsAt: input.dataset.endsAt ?? '' };
      stepError(2, '');
    }
    updateSummary();
  });

  // ─── Récapitulatif ─────────────────────────────────────────────────────────
  function estimate() {
    const s = state.service;
    if (!s) return null;
    const extra = state.options.reduce((sum, o) => sum + o.extraMinutes, 0);
    const price =
      s.onQuote || s.price == null
        ? null
        : (Math.round(s.price * 100) +
            state.options.reduce((sum, o) => sum + Math.round(o.price * 100), 0)) /
          100;
    return {
      duration: formatDuration(s.durationMin + extra, s.durationMax + extra),
      price:
        price == null ? 'Sur devis' : `${s.priceFrom ? 'à partir de ' : ''}${euro.format(price)}`,
    };
  }

  function updateSummary() {
    const e = estimate();
    $('[data-sum-service]').textContent = state.service?.name ?? 'À choisir';
    $('[data-sum-options-row]').hidden = state.options.length === 0;
    $('[data-sum-options]').textContent = state.options.map((o) => o.label).join(', ');
    $('[data-sum-duration]').textContent = e?.duration ?? '–';
    $('[data-sum-price]').textContent = e?.price ?? '–';
    $('[data-sum-date]').textContent = state.slot
      ? `${dayLabel(parisDate.format(new Date(state.slot.startsAt)))} à ${formatTime(state.slot.startsAt)}`
      : 'À choisir';
  }

  // ─── Étape 2 : calendrier et créneaux ──────────────────────────────────────
  const calendarBody = $('[data-calendar-body]');
  const calendarState = $('[data-calendar-state]');
  const monthLabelEl = $('[data-month-label]');
  const prevButton = /** @type {HTMLButtonElement} */ ($('[data-month-prev]'));
  const nextButton = /** @type {HTMLButtonElement} */ ($('[data-month-next]'));
  const slotsBox = $('[data-slots]');

  const calendar = createCalendar({
    tbody: $('[data-calendar-days]'),
    today: data.today,
    onSelect: (date) => renderSlots(date),
    onMonthChange: (month, focusDate) => loadMonth(month, { focusDate }),
  });

  function enterSlots() {
    if (!state.service) return;
    const e = estimate();
    $('[data-duration-note]').textContent =
      `${state.service.name} : prévoyez ${e?.duration} sur place. Les horaires affichés sont ceux de début du rendez-vous.`;
    const month = state.slot
      ? parisDate.format(new Date(state.slot.startsAt)).slice(0, 7)
      : state.month;
    loadMonth(month);
  }

  /**
   * Charge les créneaux d'un mois (borné à aujourd'hui et à l'horizon).
   * @param {string} month
   * @param {{ focusDate?: string }} [opts]
   */
  async function loadMonth(month, opts = {}) {
    const firstMonth = data.today.slice(0, 7);
    const lastMonth = data.lastDate.slice(0, 7);
    if (month < firstMonth || month > lastMonth || !state.service) return;
    state.month = month;
    monthLabelEl.textContent = monthLabel(month);
    prevButton.disabled = month <= firstMonth;
    nextButton.disabled = month >= lastMonth;
    calendarState.hidden = true;
    calendarBody.setAttribute('aria-busy', 'true');
    calendar.show(month, { focus: opts.focusDate });
    if (opts.focusDate) calendar.focus(opts.focusDate);

    state.loading?.abort();
    const controller = new AbortController();
    state.loading = controller;
    const from = `${month}-01` < data.today ? data.today : `${month}-01`;
    const to = monthEnd(month) > data.lastDate ? data.lastDate : monthEnd(month);
    const params = new URLSearchParams({ service: state.service.slug, from, to });
    state.options.forEach((o) => params.append('options', String(o.id)));
    try {
      const res = await fetch(`/api/booking/slots?${params}`, {
        headers: { accept: 'application/json' },
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(String(res.status));
      /** @type {{ days: { date: string, slots: Slot[] }[] }} */
      const body = await res.json();
      if (controller !== state.loading) return;
      body.days.forEach((d) => state.days.set(d.date, d.slots));
      const available = body.days.filter((d) => d.slots.length > 0).map((d) => d.date);
      calendarBody.setAttribute('aria-busy', 'false');
      calendar.show(month, { available, focus: opts.focusDate });
      if (opts.focusDate) calendar.focus(opts.focusDate);

      if (available.length === 0) {
        slotsBox.hidden = true;
        showCalendarState('empty');
        return;
      }
      const current = state.slot ? parisDate.format(new Date(state.slot.startsAt)) : null;
      const pick = current && available.includes(current) ? current : available[0];
      if (!opts.focusDate) calendar.select(pick);
    } catch (error) {
      if (/** @type {Error} */ (error).name === 'AbortError') return;
      calendarBody.setAttribute('aria-busy', 'false');
      calendar.show(month, { available: [] });
      slotsBox.hidden = true;
      showCalendarState('error');
    }
  }

  /** @param {'empty'|'error'} kind */
  function showCalendarState(kind) {
    calendarState.hidden = false;
    calendarState.className = `calendar__state${kind === 'error' ? ' calendar__state--error' : ''}`;
    const next = addMonths(state.month, 1);
    if (kind === 'error') {
      calendarState.innerHTML =
        '<p>Impossible de charger les créneaux. Vérifiez votre connexion, puis réessayez.</p><button class="btn btn--secondary btn--sm" type="button" data-retry>Réessayer</button>';
      $('[data-retry]', calendarState).addEventListener('click', () => loadMonth(state.month));
    } else if (next <= data.lastDate.slice(0, 7)) {
      calendarState.innerHTML = `<p class="calendar__empty">Plus aucun créneau disponible en ${monthLabel(state.month)} pour cette durée.</p><button class="btn btn--secondary btn--sm" type="button" data-next-month>Voir ${monthLabel(next)}</button>`;
      $('[data-next-month]', calendarState).addEventListener('click', () => loadMonth(next));
    } else {
      calendarState.innerHTML =
        '<p class="calendar__empty">Aucun créneau libre d’ici là pour cette durée. <a class="link" href="/contact">Écrivez-nous</a> : nous trouverons une solution.</p>';
    }
  }

  prevButton.addEventListener('click', () => loadMonth(addMonths(state.month, -1)));
  nextButton.addEventListener('click', () => loadMonth(addMonths(state.month, 1)));

  /** @param {string} date */
  function renderSlots(date) {
    const slots = state.days.get(date) ?? [];
    slotsBox.hidden = slots.length === 0;
    $('[data-slots-title]').textContent = dayLabel(date);
    const groups = [
      {
        label: 'Matin',
        slots: slots.filter((s) => Number(formatTime(s.startsAt).split('h')[0]) < 12),
      },
      {
        label: 'Après-midi',
        slots: slots.filter((s) => Number(formatTime(s.startsAt).split('h')[0]) >= 12),
      },
    ].filter((g) => g.slots.length);
    $('[data-slots-list]').innerHTML = groups
      .map(
        (g) =>
          `<div><p class="slots__period" aria-hidden="true">${g.label}</p><div class="slots__list">${g.slots
            .map(
              (s) =>
                `<label class="slot"><input class="slot__input" type="radio" name="startsAt" value="${s.startsAt}" data-ends-at="${s.endsAt}"${state.slot?.startsAt === s.startsAt ? ' checked' : ''} /><span class="slot__label num"><span class="visually-hidden">${g.label}, </span>${formatTime(s.startsAt)}</span></label>`,
            )
            .join('')}</div></div>`,
      )
      .join('');
  }

  // ─── Étape 3 : coordonnées, photo, envoi ───────────────────────────────────
  const submitButton = /** @type {HTMLButtonElement} */ ($('[data-submit]'));
  const formError = $('[data-form-error]');
  const photoInput = /** @type {HTMLInputElement} */ ($('#resa-photo'));
  const photoPreview = $('[data-photo-preview]');
  const photoImg = /** @type {HTMLImageElement} */ ($('[data-photo-img]'));
  const photoRemove = $('[data-photo-remove]');
  /** @type {string|null} */
  let photoUrl = null;

  /** Règles côté navigateur (confort) ; le serveur reste seul juge. */
  const checks = {
    firstName: (/** @type {string} */ v) => (v.trim() ? '' : 'Indiquez votre prénom.'),
    lastName: (/** @type {string} */ v) => (v.trim() ? '' : 'Indiquez votre nom.'),
    email: (/** @type {string} */ v) =>
      /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.trim())
        ? ''
        : 'Indiquez une adresse email complète, par exemple prenom@exemple.fr.',
    phone: (/** @type {string} */ v) =>
      /^\+?[\d\s.\-()]{8,20}$/.test(v.trim())
        ? ''
        : 'Indiquez un numéro valide, par exemple 06 12 34 56 78.',
    hairState: (/** @type {string} */ v) => (v ? '' : 'Choisissez l’état de vos cheveux.'),
    policy: (/** @type {boolean} */ v) =>
      v ? '' : 'Merci d’accepter la politique de rendez-vous.',
  };

  /** @param {string} name @param {string} message */
  function setFieldError(name, message) {
    const el = root.querySelector(`[data-error-for="${name}"]`);
    if (el) el.textContent = message;
    const control = /** @type {HTMLInputElement|null} */ (form.elements.namedItem(name));
    if (control && 'setAttribute' in control) {
      if (message) control.setAttribute('aria-invalid', 'true');
      else control.removeAttribute('aria-invalid');
    }
  }

  /** @param {string} name */
  function validateField(name) {
    const control = /** @type {HTMLInputElement} */ (form.elements.namedItem(name));
    const check = /** @type {((value: any) => string) | undefined} */ (
      checks[/** @type {keyof typeof checks} */ (name)]
    );
    if (!control || !check) return '';
    const message = check(control.type === 'checkbox' ? control.checked : control.value);
    setFieldError(name, message);
    return message;
  }

  Object.keys(checks).forEach((name) => {
    const control = /** @type {HTMLInputElement} */ (form.elements.namedItem(name));
    control?.addEventListener('blur', () => {
      if (control.value || control.getAttribute('aria-invalid')) validateField(name);
    });
    control?.addEventListener('input', () => {
      if (control.getAttribute('aria-invalid')) validateField(name);
    });
  });

  photoInput.addEventListener('change', () => {
    const file = photoInput.files?.[0];
    setFieldError('photo', '');
    if (photoUrl) URL.revokeObjectURL(photoUrl);
    photoUrl = null;
    if (!file) {
      photoPreview.hidden = true;
      photoRemove.hidden = true;
      return;
    }
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      photoInput.value = '';
      return setFieldError('photo', 'La photo doit être au format JPEG, PNG ou WebP.');
    }
    if (file.size > data.maxPhotoBytes) {
      photoInput.value = '';
      return setFieldError('photo', 'La photo dépasse 8 Mo. Choisissez une image plus légère.');
    }
    photoUrl = URL.createObjectURL(file);
    photoImg.src = photoUrl;
    $('[data-photo-name]').textContent = file.name;
    photoPreview.hidden = false;
    photoRemove.hidden = false;
  });
  photoRemove.addEventListener('click', () => {
    photoInput.value = '';
    photoInput.dispatchEvent(new Event('change'));
    photoInput.focus();
  });

  /** @param {string} message @param {Record<string, string>} [fields] */
  function showFormError(message, fields = {}) {
    const items = Object.entries(fields)
      .filter(([name]) => root.querySelector(`[data-error-for="${name}"]`))
      .map(([name, text]) => {
        const id = root.querySelector(`[data-error-for="${name}"]`)?.id.replace(/-erreur$/, '');
        return `<li><a class="link" href="#${id}">${escapeHtml(text)}</a></li>`;
      });
    formError.innerHTML = `<p class="booking-alert__title">${escapeHtml(message)}</p>${items.length ? `<ul>${items.join('')}</ul>` : ''}`;
    formError.hidden = false;
    formError.focus();
  }

  // Liens du résumé d'erreurs : amènent le focus sur le champ concerné.
  formError.addEventListener('click', (event) => {
    const link = /** @type {HTMLElement} */ (event.target).closest('a[href^="#"]');
    if (!link) return;
    const target = document.getElementById(link.getAttribute('href')?.slice(1) ?? '');
    if (!target) return;
    event.preventDefault();
    target.focus();
  });

  /** @param {boolean} busy */
  function setBusy(busy) {
    submitButton.setAttribute('aria-busy', String(busy));
    submitButton.disabled = busy;
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (state.step !== 3) return;
    formError.hidden = true;
    /** @type {Record<string, string>} */
    const errors = {};
    for (const name of Object.keys(checks)) {
      const message = validateField(name);
      if (message) errors[name] = message;
    }
    if (Object.keys(errors).length) {
      return showFormError('Quelques informations sont à compléter :', errors);
    }

    setBusy(true);
    try {
      const body = new FormData(form);
      if (!photoInput.files?.length) body.delete('photo');
      body.set('altcha', await (state.solution ?? (state.solution = solveChallenge())));
      const res = await fetch(form.action, {
        method: 'POST',
        body,
        headers: { accept: 'application/json', 'x-csrf-token': form.dataset.csrf ?? '' },
      });
      const result = await res.json().catch(() => ({}));
      if (res.status === 201) return showConfirmation(result);

      // Une solution anti-robot ne sert qu'une fois : on en prépare une nouvelle.
      state.solution = null;
      if (res.status === 409) {
        resetSlot();
        updateSummary();
        goTo(2);
        stepError(2, result.message ?? 'Ce créneau vient d’être pris. Choisissez-en un autre.');
        return;
      }
      if (result.fields) {
        Object.entries(/** @type {Record<string, string>} */ (result.fields)).forEach(
          ([name, text]) => setFieldError(name, text),
        );
      }
      if (res.status === 403) {
        return showFormError(
          'Votre session a expiré. Rechargez la page pour réessayer (vos choix seront à refaire).',
        );
      }
      showFormError(
        result.message ?? 'Votre demande n’a pas pu être envoyée. Réessayez.',
        result.fields,
      );
    } catch {
      state.solution = null;
      showFormError('La connexion a échoué. Vérifiez votre réseau, puis réessayez.');
    } finally {
      setBusy(false);
    }
  });

  // ─── Étape 4 : confirmation ────────────────────────────────────────────────
  /** @param {any} r */
  function showConfirmation(r) {
    state.done = true;
    const a = r.appointment;
    const pending = r.status === 'pending';
    $('[data-done-title]').innerHTML = pending
      ? 'Demande <em>envoyée</em>.'
      : `C’est <em>noté</em>, ${escapeHtml(a.firstName)}.`;
    $('[data-done-lead]').textContent = pending
      ? 'Le salon valide votre demande au plus vite. Vous pouvez déjà la retrouver avec le lien ci-dessous.'
      : `Votre rendez-vous est confirmé : ${a.dayLabel} à ${a.timeLabel}.`;
    const rows = [
      ['Prestation', a.serviceName],
      ...(a.options.length ? [['Options', a.options.join(', ')]] : []),
      ['Date', `${a.dayLabel} à ${a.timeLabel}`],
      ['Durée à prévoir', a.durationLabel],
      ['Prix estimé', a.priceLabel],
    ];
    $('[data-done-recap]').innerHTML = rows
      .map(([k, v]) => `<div><dt>${escapeHtml(k)}</dt><dd>${escapeHtml(v)}</dd></div>`)
      .join('');
    /** @type {HTMLAnchorElement} */ ($('[data-done-manage]')).href = r.manageUrl;
    /** @type {HTMLAnchorElement} */ ($('[data-done-ics]')).href = r.icsUrl;
    /** @type {HTMLAnchorElement} */ ($('[data-done-google]')).href = r.googleUrl;
    $('[data-done-hours]').textContent = String(r.cancellationHours);
    $('[data-done-tips]').innerHTML = r.tips
      .map((/** @type {string} */ t) => `<li>${escapeHtml(t)}</li>`)
      .join('');
    goTo(4);
  }

  // ─── Démarrage ─────────────────────────────────────────────────────────────
  history.replaceState({ bookingStep: 1 }, '', location.pathname + location.search);
  const preselected = /** @type {HTMLInputElement|null} */ (
    form.querySelector('input[name="service"]:checked')
  );
  if (preselected) {
    state.service = data.services.find((s) => s.slug === preselected.value) ?? null;
    renderOptions();
  }
  updateSummary();
  root.dataset.stepCurrent = '1';
}

const root = /** @type {HTMLElement|null} */ (document.querySelector('[data-booking]'));
if (root) initBooking(root);
