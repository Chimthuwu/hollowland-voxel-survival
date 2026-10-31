import { Block, type Biome } from './world';

export type Recipe = 'torch' | 'weapon' | 'scaffold' | 'totem';
export type InventorySlot = { id: Block; count: number };

// Ingredient amounts are kept here so they can be tuned without changing the UI.
export const RECIPES: Record<Recipe, { name: string; description: string }> = {
  torch: { name: 'Torch ×4', description: '1 wood + 1 stone' },
  weapon: { name: 'Stone blade', description: '2 wood + 3 stone' },
  scaffold: { name: 'Scaffold ×4', description: '2 wood' },
  totem: { name: 'Warding totem', description: '3 stone + 2 glitch / flesh' },
};

const NAMES: Record<number, string> = {
  [Block.Air]: 'Air', [Block.Dirt]: 'Dirt', [Block.Stone]: 'Stone',
  [Block.Wood]: 'Wood', [Block.Mud]: 'Mud', [Block.Glitch]: 'Glitch',
  [Block.Flesh]: 'Flesh', [Block.Bone]: 'Bone', [Block.Torch]: 'Torch',
  [Block.Scaffold]: 'Scaffold', [Block.Totem]: 'Totem', [Block.Scorched]: 'Scorched',
};

export class Inventory {
  slots: InventorySlot[] = [];
  selected = 0;
  weapon = false;

  add(id: Block, count = 1): boolean {
    if (id === Block.Air || !Number.isInteger(count) || count <= 0) return false;
    const slot = this.slots.find(item => item.id === id);
    if (slot) { slot.count += count; return true; }
    if (this.slots.length >= 9) return false;
    this.slots.push({ id, count });
    return true;
  }

  remove(id: Block, count = 1): boolean {
    if (!Number.isInteger(count) || count <= 0) return false;
    const index = this.slots.findIndex(item => item.id === id);
    if (index < 0 || this.slots[index].count < count) return false;
    this.slots[index].count -= count;
    if (this.slots[index].count === 0) {
      this.slots.splice(index, 1);
      if (index < this.selected) this.selected--;
      if (this.selected >= this.slots.length) this.selected = Math.max(0, this.slots.length - 1);
    }
    return true;
  }

  count(id: Block): number { return this.slots.find(item => item.id === id)?.count ?? 0; }
  selectedItem(): InventorySlot | undefined { return this.slots[this.selected]; }

  craft(recipe: Recipe): boolean {
    // Work on a copy: neither a missing ingredient nor a full inventory may consume resources.
    const trial = new Inventory();
    trial.slots = this.slots.map(slot => ({ ...slot }));
    trial.selected = this.selected;
    trial.weapon = this.weapon;
    let success = false;
    switch (recipe) {
      case 'torch':
        success = trial.remove(Block.Wood, 1) && trial.remove(Block.Stone, 1) && trial.add(Block.Torch, 4);
        break;
      case 'weapon':
        success = !trial.weapon && trial.remove(Block.Wood, 2) && trial.remove(Block.Stone, 3);
        if (success) trial.weapon = true;
        break;
      case 'scaffold':
        success = trial.remove(Block.Wood, 2) && trial.add(Block.Scaffold, 4);
        break;
      case 'totem': {
        const glitch = Math.min(2, trial.count(Block.Glitch));
        const flesh = 2 - glitch;
        success = trial.count(Block.Flesh) >= flesh && trial.remove(Block.Stone, 3)
          && (glitch === 0 || trial.remove(Block.Glitch, glitch))
          && (flesh === 0 || trial.remove(Block.Flesh, flesh)) && trial.add(Block.Totem);
        break;
      }
    }
    if (!success) return false;
    this.slots = trial.slots;
    this.selected = trial.selected;
    this.weapon = trial.weapon;
    return true;
  }
}

function node<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

/** Owns the DOM only. The game owns keyboard, mouse, pointer lock and simulation. */
export class UI {
  readonly startButton: HTMLButtonElement;
  private readonly root: HTMLElement;
  private readonly intro: HTMLElement;
  private readonly death: HTMLElement;
  private readonly inventoryPanel: HTMLElement;
  private readonly inventoryGrid: HTMLElement;
  private readonly craftingPanel: HTMLElement;
  private readonly hotbar: HTMLElement;
  private readonly details: HTMLElement;
  private readonly resumeHint: HTMLElement;
  private readonly biome: HTMLElement;
  private readonly bars: Record<'health' | 'sanity' | 'stamina', HTMLElement>;
  private openPanel: 'inventory' | 'crafting' | null = null;
  private signature = '';

  constructor(private readonly inventory: Inventory, private readonly onMenuChange: (open: boolean) => void) {
    this.root = node('div', 'hollow-ui');
    const hud = node('div', 'hud');
    const corner = node('div', 'hud-corner');
    corner.append(node('div', 'eyebrow', 'HOLLOWLAND / SURVIVAL'));
    this.biome = node('div', 'biome', 'THE OVERCAST');
    corner.append(this.biome);
    const vitals = node('div', 'vitals');
    this.bars = {} as Record<'health' | 'sanity' | 'stamina', HTMLElement>;
    for (const [key, label] of [['health', 'VITALITY'], ['sanity', 'SANITY'], ['stamina', 'STAMINA']] as const) {
      const row = node('div', `vital vital-${key}`);
      row.append(node('span', 'vital-label', label));
      const track = node('span', 'vital-track');
      const fill = node('span', 'vital-fill');
      track.append(fill); row.append(track); vitals.append(row); this.bars[key] = fill;
    }
    corner.append(vitals);
    this.details = node('div', 'world-info', '');
    this.resumeHint = node('div', 'resume-hint hidden', 'CLICK THE WORLD TO RESUME · ESC RELEASES POINTER');
    document.addEventListener('pointerlockchange', () => this.updateResumeHint());
    const crosshair = node('div', 'crosshair');
    crosshair.setAttribute('aria-hidden', 'true');
    this.hotbar = node('div', 'hotbar');
    this.hotbar.setAttribute('aria-label', 'Quick slots');
    hud.append(corner, this.details, crosshair, this.resumeHint, this.hotbar);

    this.inventoryPanel = node('section', 'menu-panel inventory-panel hidden');
    this.inventoryGrid = node('div', 'inventory-grid');
    this.inventoryPanel.append(node('div', 'eyebrow', 'WHAT YOU CARRY'), node('h2', '', 'Inventory'),
      node('p', 'panel-copy', 'Choose a slot below. The things you gather may keep you alive.'),
      this.inventoryGrid, node('p', 'menu-hint', 'E  /  CLOSE    ·    CLICK A SLOT  /  SELECT'));
    this.craftingPanel = node('section', 'menu-panel crafting-panel hidden');
    this.craftingPanel.append(node('div', 'eyebrow', 'MAKE SOMETHING OF THE DARK'), node('h2', '', 'Crafting'),
      node('p', 'panel-copy', 'Gather what you need. Click a recipe to craft it.'));
    const recipes = node('div', 'recipes');
    for (const recipe of Object.keys(RECIPES) as Recipe[]) {
      const button = node('button', 'recipe');
      button.type = 'button';
      button.append(node('strong', '', RECIPES[recipe].name), node('span', '', RECIPES[recipe].description));
      button.addEventListener('click', () => {
        const crafted = this.inventory.craft(recipe);
        this.refresh();
        this.craftFeedback.textContent = crafted ? `${RECIPES[recipe].name} crafted.` : 'Not enough materials, inventory full, or already crafted.';
      });
      recipes.append(button);
    }
    this.craftingPanel.append(recipes);
    this.craftFeedback = node('p', 'craft-feedback', 'C  /  CLOSE');
    this.craftFeedback.setAttribute('aria-live', 'polite');
    this.craftingPanel.append(this.craftFeedback);

    this.intro = node('div', 'screen-overlay intro');
    const introCard = node('div', 'intro-card');
    introCard.append(node('div', 'eyebrow', 'A VOXEL SURVIVAL NIGHTMARE'), node('h1', 'title', 'HOLLOWLAND'),
      node('p', 'tagline', 'The world is listening.'),
      node('p', 'intro-copy', 'Gather what you can. Build a little light. Keep your mind intact. There are things here that do not want you to leave.'));
    const controls = node('div', 'controls');
    for (const [key, action] of [['W A S D', 'MOVE'], ['MOUSE', 'LOOK'], ['SPACE / SHIFT', 'JUMP / SPRINT'], ['LEFT / RIGHT CLICK', 'MINE / PLACE'], ['E / C', 'INVENTORY / CRAFT'], ['1—9 / WHEEL', 'SELECT']]) {
      const row = node('div', 'control'); row.append(node('b', '', key), node('span', '', action)); controls.append(row);
    }
    this.startButton = node('button', 'start-button', 'ENTER THE HOLLOW');
    this.startButton.type = 'button';
    introCard.append(controls, this.startButton, node('p', 'pointer-note', 'Click to play and lock the pointer. Press Esc to release it.'));
    this.intro.append(introCard);

    this.death = node('div', 'screen-overlay death-screen hidden');
    const deathCard = node('div', 'death-card');
    deathCard.append(node('div', 'eyebrow', 'THE HOLLOW REMEMBERS'), node('h2', 'death-title', 'GAME OVER'),
      node('p', '', 'The dark takes what it is owed.'));
    this.death.append(deathCard);
    this.root.append(hud, this.inventoryPanel, this.craftingPanel, this.intro, this.death);
    document.body.append(this.root);
    this.refresh();
  }

  private readonly craftFeedback: HTMLElement;

  update(health: number, sanity: number, stamina: number, biome: Biome, info: string): void {
    for (const [key, value] of [['health', health], ['sanity', sanity], ['stamina', stamina]] as const) {
      this.bars[key].style.width = `${Math.max(0, Math.min(100, Number.isFinite(value) ? value : 0))}%`;
    }
    this.biome.textContent = `THE ${biome.toUpperCase()}`;
    this.details.textContent = info;
    this.refresh();
  }

  toggleInventory(): void { this.setPanel(this.openPanel === 'inventory' ? null : 'inventory'); }
  toggleCrafting(): void { this.setPanel(this.openPanel === 'crafting' ? null : 'crafting'); }
  close(): void { this.setPanel(null); }
  setDeath(visible: boolean): void { this.death.classList.toggle('hidden', !visible); if (visible) this.close(); this.updateResumeHint(); }
  setStarted(started: boolean): void { this.intro.classList.toggle('hidden', started); this.updateResumeHint(); }

  private updateResumeHint(): void {
    const visible = this.intro.classList.contains('hidden') && this.death.classList.contains('hidden')
      && this.openPanel === null && !document.pointerLockElement;
    this.resumeHint.classList.toggle('hidden', !visible);
  }

  private setPanel(panel: 'inventory' | 'crafting' | null): void {
    if (this.openPanel === panel) return;
    const wasOpen = this.openPanel !== null;
    this.openPanel = panel;
    this.inventoryPanel.classList.toggle('hidden', panel !== 'inventory');
    this.craftingPanel.classList.toggle('hidden', panel !== 'crafting');
    this.root.classList.toggle('menu-open', panel !== null);
    this.updateResumeHint();
    this.refresh();
    if (wasOpen !== (panel !== null)) this.onMenuChange(panel !== null);
  }

  private refresh(): void {
    const signature = JSON.stringify([this.inventory.slots, this.inventory.selected, this.inventory.weapon]);
    if (signature === this.signature) return;
    this.signature = signature;
    this.hotbar.replaceChildren();
    this.inventoryGrid.replaceChildren();
    for (let i = 0; i < 9; i++) {
      const item = this.inventory.slots[i];
      const button = node('button', `slot${this.inventory.selected === i ? ' selected' : ''}`);
      button.type = 'button';
      button.setAttribute('aria-label', `Slot ${i + 1}: ${item ? `${NAMES[item.id] ?? 'Unknown'} ×${item.count}` : 'empty'}`);
      button.title = item ? NAMES[item.id] ?? 'Unknown' : 'Empty';
      button.append(node('span', 'slot-key', String(i + 1)));
      if (item) {
        const icon = node('span', `slot-icon block-${item.id}`);
        icon.setAttribute('aria-hidden', 'true');
        button.append(icon, node('span', 'slot-name', NAMES[item.id] ?? 'Unknown'), node('span', 'slot-count', String(item.count)));
      }
      button.addEventListener('click', () => { this.inventory.selected = i; this.refresh(); });
      const gridButton = button.cloneNode(true) as HTMLButtonElement;
      gridButton.addEventListener('click', () => { this.inventory.selected = i; this.refresh(); });
      this.inventoryGrid.append(gridButton);
      this.hotbar.append(button);
    }
  }
}
