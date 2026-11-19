// @ts-check
/**
 * Envoi de photos pour la galerie : choix multiple ou dépôt, recadrage dans un canvas (format
 * portrait, carré ou paysage, zoom, déplacement au doigt ou à la souris), titre et texte
 * alternatif obligatoire (avec suggestion), puis envoi d'une photo par requête.
 * Le serveur ré-encode toujours l'image : le recadrage ne sert qu'au cadrage.
 */
import { postJson } from './admin-http.js';

const OUTPUT_LONG_SIDE = 1600;

/** @param {HTMLSelectElement|null} select */
const selectedLabel = (select) =>
  select && select.value ? (select.selectedOptions[0]?.textContent ?? '').trim() : '';

export function initUploader() {
  const root = /** @type {HTMLElement|null} */ (document.querySelector('[data-uploader]'));
  if (!root) return;
  const input = /** @type {HTMLInputElement} */ (root.querySelector('[data-file-input]'));
  const zone = /** @type {HTMLElement} */ (root.querySelector('[data-dropzone]'));
  const queue = /** @type {HTMLElement} */ (root.querySelector('[data-queue]'));
  const template = /** @type {HTMLTemplateElement} */ (root.querySelector('[data-item-template]'));
  const url = root.dataset.url ?? '';
  let pendingCount = 0;
  let sent = 0;

  /** @param {FileList|File[]} files */
  const addFiles = (files) => {
    for (const file of files) {
      if (!/^image\/(jpeg|png|webp)$/.test(file.type)) continue;
      addItem(file);
    }
  };
  input.addEventListener('change', () => {
    addFiles(input.files ?? []);
    input.value = '';
  });
  for (const type of ['dragenter', 'dragover']) {
    zone.addEventListener(type, (event) => {
      event.preventDefault();
      zone.classList.add('is-over');
    });
  }
  for (const type of ['dragleave', 'drop']) {
    zone.addEventListener(type, () => zone.classList.remove('is-over'));
  }
  zone.addEventListener('drop', (event) => {
    event.preventDefault();
    addFiles(/** @type {DragEvent} */ (event).dataTransfer?.files ?? []);
  });

  /** @param {File} file */
  async function addItem(file) {
    const fragment = /** @type {DocumentFragment} */ (template.content.cloneNode(true));
    const form = /** @type {HTMLFormElement} */ (fragment.querySelector('[data-item]'));
    const uid = `up${Math.random().toString(36).slice(2, 8)}`;
    // Identifiants uniques : un même gabarit sert pour chaque photo.
    for (const el of form.querySelectorAll('[id^="tpl-"]'))
      el.id = el.id.replace('tpl-', `${uid}-`);
    for (const el of form.querySelectorAll('label[for^="tpl-"]')) {
      el.setAttribute(
        'for',
        /** @type {string} */ (el.getAttribute('for')).replace('tpl-', `${uid}-`),
      );
    }
    for (const el of form.querySelectorAll('[aria-describedby]')) {
      el.setAttribute(
        'aria-describedby',
        /** @type {string} */ (el.getAttribute('aria-describedby')).replaceAll('tpl-', `${uid}-`),
      );
    }
    queue.append(fragment);
    pendingCount += 1;

    const canvas = /** @type {HTMLCanvasElement} */ (form.querySelector('[data-canvas]'));
    const zoom = /** @type {HTMLInputElement} */ (form.querySelector('[data-zoom]'));
    const errorBox = /** @type {HTMLElement} */ (form.querySelector('[data-error]'));
    const ratioButtons = /** @type {HTMLButtonElement[]} */ ([
      ...form.querySelectorAll('[data-ratio]'),
    ]);
    const field = (/** @type {string} */ name) =>
      /** @type {HTMLInputElement} */ (form.elements.namedItem(name));
    const title = field('title');
    const alt = field('alt');
    const category = /** @type {HTMLSelectElement} */ (
      /** @type {unknown} */ (field('categoryId'))
    );
    const method = /** @type {HTMLSelectElement} */ (/** @type {unknown} */ (field('methodId')));
    const size = /** @type {HTMLSelectElement} */ (/** @type {unknown} */ (field('sizeTagId')));
    title.value = file.name
      .replace(/\.[^.]+$/, '')
      .replace(/[-_]+/g, ' ')
      .slice(0, 120);

    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' }).catch(
      () => null,
    );
    if (!bitmap) {
      errorBox.textContent = 'Cette image ne peut pas être lue.';
      errorBox.hidden = false;
      return;
    }

    let ratio = [4, 5];
    let scale = 1;
    let cx = bitmap.width / 2;
    let cy = bitmap.height / 2;

    /** Zone de l'image affichée : couvre le cadre, réduite par le zoom. */
    const viewport = () => {
      const frame = ratio[0] / ratio[1];
      let w = bitmap.width;
      let h = w / frame;
      if (h > bitmap.height) {
        h = bitmap.height;
        w = h * frame;
      }
      w /= scale;
      h /= scale;
      const x = Math.min(bitmap.width - w, Math.max(0, cx - w / 2));
      const y = Math.min(bitmap.height - h, Math.max(0, cy - h / 2));
      cx = x + w / 2;
      cy = y + h / 2;
      return { x, y, w, h };
    };
    const draw = () => {
      const v = viewport();
      canvas.height = Math.round((canvas.width * ratio[1]) / ratio[0]);
      const ctx = /** @type {CanvasRenderingContext2D} */ (canvas.getContext('2d'));
      ctx.drawImage(bitmap, v.x, v.y, v.w, v.h, 0, 0, canvas.width, canvas.height);
    };
    draw();

    zoom.addEventListener('input', () => {
      scale = Number(zoom.value);
      draw();
    });
    for (const button of ratioButtons) {
      button.addEventListener('click', () => {
        const [w, h] = /** @type {string} */ (button.dataset.ratio).split(':').map(Number);
        ratio = [w, h];
        for (const b of ratioButtons) b.setAttribute('aria-pressed', String(b === button));
        draw();
      });
    }
    /** @type {{ x: number, y: number }|null} */
    let last = null;
    canvas.addEventListener('pointerdown', (event) => {
      last = { x: event.clientX, y: event.clientY };
      canvas.setPointerCapture(event.pointerId);
    });
    canvas.addEventListener('pointermove', (event) => {
      if (!last) return;
      const v = viewport();
      const k = v.w / canvas.getBoundingClientRect().width;
      cx -= (event.clientX - last.x) * k;
      cy -= (event.clientY - last.y) * k;
      last = { x: event.clientX, y: event.clientY };
      draw();
    });
    canvas.addEventListener('pointerup', () => (last = null));
    canvas.addEventListener('pointercancel', () => (last = null));

    // Texte alternatif : suggestion tant que la propriétaire n'a pas écrit le sien.
    let suggested = '';
    const suggest = () => {
      const parts = [
        selectedLabel(category),
        selectedLabel(method) ? `méthode ${selectedLabel(method)}` : '',
        selectedLabel(size) ? `locks ${selectedLabel(size)}` : '',
      ].filter(Boolean);
      const next = parts.length ? `Réalisation du salon : ${parts.join(', ')}.` : '';
      if (alt.value === '' || alt.value === suggested) alt.value = next;
      suggested = next;
    };
    for (const select of [category, method, size]) select.addEventListener('change', suggest);

    form.querySelector('[data-remove]')?.addEventListener('click', () => {
      form.remove();
      pendingCount -= 1;
    });

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      errorBox.hidden = true;
      if (!title.value.trim() || alt.value.trim().length < 5) {
        errorBox.textContent = 'Le titre et le texte alternatif sont obligatoires.';
        errorBox.hidden = false;
        return;
      }
      const v = viewport();
      const out = document.createElement('canvas');
      const k = OUTPUT_LONG_SIDE / Math.max(v.w, v.h);
      out.width = Math.round(v.w * Math.min(1, k));
      out.height = Math.round(v.h * Math.min(1, k));
      /** @type {CanvasRenderingContext2D} */ (out.getContext('2d')).drawImage(
        bitmap,
        v.x,
        v.y,
        v.w,
        v.h,
        0,
        0,
        out.width,
        out.height,
      );
      const blob = await new Promise((resolve) => out.toBlob(resolve, 'image/jpeg', 0.9));
      if (!blob) return;
      const data = new FormData();
      data.set('title', title.value.trim());
      data.set('alt', alt.value.trim());
      data.set('categoryId', category.value);
      data.set('methodId', method.value);
      data.set('sizeTagId', size.value);
      if (/** @type {HTMLInputElement} */ (form.elements.namedItem('featured')).checked)
        data.set('featured', '1');
      data.set('photo', /** @type {Blob} */ (blob), 'photo.jpg');
      const submit = /** @type {HTMLButtonElement} */ (form.querySelector('[type="submit"]'));
      submit.disabled = true;
      const result = await postJson(url, data);
      if (!result.ok) {
        submit.disabled = false;
        const fields = result.data?.fields ?? {};
        errorBox.textContent = Object.values(fields)[0] ?? 'L’envoi a échoué. Réessayez.';
        errorBox.hidden = false;
        return;
      }
      sent += 1;
      form.replaceChildren(
        Object.assign(document.createElement('p'), {
          textContent: `✓ « ${title.value.trim()} » est en ligne.`,
        }),
      );
      pendingCount -= 1;
      if (pendingCount === 0) location.reload();
    });
  }
  void sent;
}
