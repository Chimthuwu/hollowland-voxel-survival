/**
 * DOM overlay for the knapping minigame. Owns its DOM only — the parent
 * supplies the stylesheet via the .knapping-* classes below. All teardown
 * (timers, listeners, DOM) is bound to close() and runs safely when called
 * multiple times.
 */

import {
  createKnappingPlan,
  isComplete,
  knappingQuality,
  knappingScore,
  removeFlake,
  toolHeadBlock,
  type FlakeCell,
  type KnapQuality,
  type KnapTool,
  type KnappingPlan,
} from './knappingCore';

export interface KnappingResult {
  tool: KnapTool;
  quality: KnapQuality;
  score: number;
  /** The descriptive head name (e.g. 'Flint Pick Head'). */
  headName: string;
}

export interface KnappingCallbacks {
  /** Fired when the player finishes knapping a usable head (quality !== 'broken'). */
  onComplete(result: KnappingResult): void;
  /** Fired when the player cancels (Esc / close button). */
  onCancel(): void;
}

const COMPLETE_DELAY_MS = 700;
const WRONG_FLASH_MS = 500;

/** Local helper that mirrors the house-style node() from ui.ts. */
function node<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

export class KnappingMinigame {
  /** Read-only flag for the outside world — true while the overlay is live. */
  get active(): boolean {
    return this._activeFlag;
  }

  private readonly _container: HTMLElement;
  private readonly _callbacks: KnappingCallbacks;

  private _overlay: HTMLElement | null = null;
  private _panel: HTMLElement | null = null;
  private _title: HTMLElement | null = null;
  private _subtitle: HTMLElement | null = null;
  private _grid: HTMLElement | null = null;
  private _status: HTMLElement | null = null;
  private _score: HTMLElement | null = null;
  private _actions: HTMLElement | null = null;
  private _hint: HTMLElement | null = null;
  private _cellRefs: Map<string, HTMLButtonElement> = new Map();

  private _plan: KnappingPlan | null = null;
  private _wrongClicks = 0;
  private _requiredRemoved = 0;
  private _completed = false;
  private _activeFlag = false;

  private _completeTimer: ReturnType<typeof setTimeout> | null = null;
  private _wrongTimer: ReturnType<typeof setTimeout> | null = null;
  private _keyHandler: ((e: KeyboardEvent) => void) | null = null;

  constructor(container: HTMLElement, callbacks: KnappingCallbacks) {
    if (typeof HTMLElement === 'undefined' || !(container instanceof HTMLElement)) {
      throw new Error('KnappingMinigame: container must be an HTMLElement');
    }
    this._container = container;
    this._callbacks = callbacks;
  }

  /** Open the minigame for a tool head. Silently replaces any prior session. */
  open(tool: KnapTool): void {
    if (this._activeFlag) this._teardown(false);

    this._plan = createKnappingPlan(tool);
    this._wrongClicks = 0;
    this._requiredRemoved = 0;
    this._completed = false;

    this._buildDOM();

    this._keyHandler = (e) => this._handleKey(e);
    document.addEventListener('keydown', this._keyHandler);

    const first = this._cellRefs.get('0,0');
    if (first) first.focus();

    this._activeFlag = true;
  }

  /** Close and tear down. Safe to call twice or when not open. Does not fire onCancel. */
  close(): void {
    if (!this._activeFlag) return;
    this._teardown(false);
  }

  /** Player-initiated cancel (Cancel button / Escape). Fires onCancel. */
  private cancel(): void {
    if (!this._activeFlag) return;
    this._teardown(true);
  }

  private _teardown(fireCancel: boolean): void {
    if (this._completeTimer !== null) {
      clearTimeout(this._completeTimer);
      this._completeTimer = null;
    }
    if (this._wrongTimer !== null) {
      clearTimeout(this._wrongTimer);
      this._wrongTimer = null;
    }
    if (this._keyHandler) {
      document.removeEventListener('keydown', this._keyHandler);
      this._keyHandler = null;
    }
    if (this._overlay) {
      this._overlay.remove();
    }
    this._overlay = null;
    this._panel = null;
    this._title = null;
    this._subtitle = null;
    this._grid = null;
    this._status = null;
    this._score = null;
    this._actions = null;
    this._hint = null;
    this._cellRefs.clear();
    this._plan = null;
    this._wrongClicks = 0;
    this._requiredRemoved = 0;
    this._completed = false;

    const wasActive = this._activeFlag;
    this._activeFlag = false;
    if (fireCancel && wasActive) this._callbacks.onCancel();
  }

  private _buildDOM(): void {
    const plan = this._plan;
    if (!plan) return;

    this._overlay = node('div', 'knapping-overlay');
    this._overlay.setAttribute('role', 'dialog');
    this._overlay.setAttribute('aria-modal', 'true');
    this._overlay.setAttribute('aria-label', `Knapping: ${plan.headName}`);

    this._panel = node('section', 'knapping-panel');

    this._title = node('h2', 'knapping-title', `Knapping: ${plan.headName}`);
    this._subtitle = node('p', 'knapping-subtitle', 'Chip away the highlighted flakes to reveal the tool head.');

    this._grid = node('div', 'knapping-grid');
    this._grid.setAttribute('role', 'grid');
    this._grid.setAttribute('aria-label', 'Stone flakes');

    for (let y = 0; y < plan.gridSize; y++) {
      for (let x = 0; x < plan.gridSize; x++) {
        const cell = plan.cells.find(c => c.x === x && c.y === y);
        if (!cell) continue;
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'knapping-cell';
        button.dataset.x = String(x);
        button.dataset.y = String(y);
        this._applyCellClasses(button, cell);
        button.setAttribute('aria-label', this._cellAriaLabel(cell));
        button.addEventListener('click', () => this._handleClick(x, y, button));
        this._grid.appendChild(button);
        this._cellRefs.set(`${x},${y}`, button);
      }
    }

    this._status = node('p', 'knapping-status', 'Begin. The stone waits.');
    this._status.setAttribute('aria-live', 'polite');
    this._score = node('p', 'knapping-score', '');

    this._actions = node('div', 'knapping-actions');
    const cancelButton = node('button', 'knapping-button', 'Cancel');
    cancelButton.type = 'button';
    cancelButton.addEventListener('click', () => this.cancel());
    this._actions.appendChild(cancelButton);

    this._hint = node('p', 'knapping-hint', 'The highlighted flakes are your target — the plain rock is excess. Each wrong click chips away from your score.');

    this._panel.append(this._title, this._subtitle, this._grid, this._status, this._score, this._actions, this._hint);
    this._overlay.appendChild(this._panel);
    this._container.appendChild(this._overlay);
  }

  private _applyCellClasses(button: HTMLButtonElement, cell: FlakeCell): void {
    button.classList.remove('required', 'solid', 'removed');
    if (!cell.solid) return;
    if (!cell.present) {
      button.classList.add('removed');
      return;
    }
    button.classList.add('solid');
    if (cell.required) button.classList.add('required');
  }

  private _cellAriaLabel(cell: FlakeCell): string {
    const col = cell.x + 1;
    const row = cell.y + 1;
    if (!cell.solid) return `Empty socket at column ${col}, row ${row}`;
    if (!cell.present) return `Chipped flake at column ${col}, row ${row}`;
    if (cell.required) return `Target flake at column ${col}, row ${row} — chip to reveal the head`;
    return `Stone flake at column ${col}, row ${row}`;
  }

  private _handleClick(x: number, y: number, button: HTMLButtonElement): void {
    const plan = this._plan;
    if (!plan) return;
    const cell = plan.cells.find(c => c.x === x && c.y === y);
    if (!cell) return;

    const result = removeFlake(plan, x, y);
    if (result === 'already') return;

    if (result === 'ok') {
      this._requiredRemoved++;
      this._applyCellClasses(button, cell);
      if (this._status) this._status.textContent = 'Good — keep going.';
      if (isComplete(plan)) {
        this._completeKnapping();
        return;
      }
    } else {
      this._wrongClicks++;
      button.classList.add('wrong');
      if (this._status) this._status.textContent = 'Too much stone gone — the edge is ragged.';
      if (this._wrongTimer !== null) clearTimeout(this._wrongTimer);
      this._wrongTimer = setTimeout(() => {
        this._wrongTimer = null;
        button.classList.remove('wrong');
        this._applyCellClasses(button, cell);
      }, WRONG_FLASH_MS);
    }
    this._updateScoreReadout();
  }

  private _updateScoreReadout(): void {
    const plan = this._plan;
    if (!this._score || !plan) return;
    if (this._completed) {
      const score = knappingScore(plan, this._wrongClicks);
      const quality = knappingQuality(score);
      this._score.textContent = `Quality: ${quality} · Score: ${Math.round(score * 100)}%`;
    } else {
      this._score.textContent = `Progress: ${this._requiredRemoved} / ${plan.requiredCount}  ·  Mistakes: ${this._wrongClicks}`;
    }
  }

  private _completeKnapping(): void {
    const plan = this._plan;
    if (!plan) return;
    this._completed = true;

    const score = knappingScore(plan, this._wrongClicks);
    const quality = knappingQuality(score);
    const headBlock = toolHeadBlock(plan.tool, quality);
    const planHeadName = plan.headName;

    if (this._title) this._title.textContent = `${planHeadName} — ${quality}`;
    if (this._status) this._status.textContent = `Done. ${headBlock}, ${quality}.`;
    this._updateScoreReadout();

    const result: KnappingResult = {
      tool: plan.tool,
      quality,
      score,
      headName: planHeadName,
    };

    this._completeTimer = setTimeout(() => {
      this._completeTimer = null;
      if (!this.active) return;
      this._teardown(false);
      this._callbacks.onComplete(result);
    }, COMPLETE_DELAY_MS);
  }

  private _handleKey(e: KeyboardEvent): void {
    if (!this.active) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      this.cancel();
      return;
    }
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown' && e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    const focused = document.activeElement as HTMLElement | null;
    if (!focused || !focused.dataset) return;
    const xAttr = focused.dataset['x'];
    const yAttr = focused.dataset['y'];
    if (xAttr === undefined || yAttr === undefined) return;
    const x = Number(xAttr);
    const y = Number(yAttr);
    if (!Number.isInteger(x) || !Number.isInteger(y)) return;
    let dx = 0;
    let dy = 0;
    if (e.key === 'ArrowUp') dy = -1;
    else if (e.key === 'ArrowDown') dy = 1;
    else if (e.key === 'ArrowLeft') dx = -1;
    else if (e.key === 'ArrowRight') dx = 1;
    const plan = this._plan;
    if (!plan) return;
    const nx = x + dx;
    const ny = y + dy;
    if (nx < 0 || ny < 0 || nx >= plan.gridSize || ny >= plan.gridSize) return;
    const next = this._cellRefs.get(`${nx},${ny}`);
    if (next) {
      e.preventDefault();
      next.focus();
    }
  }
}
