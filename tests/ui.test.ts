import { describe, expect, it } from 'vitest';
import { Block } from '../src/world';
import { Inventory } from '../src/ui';

describe('Inventory', () => {
  it('stacks resources and removes only what is available', () => {
    const inventory = new Inventory();
    expect(inventory.add(Block.Wood, 3)).toBe(true);
    expect(inventory.add(Block.Wood, 2)).toBe(true);
    expect(inventory.slots).toEqual([{ id: Block.Wood, count: 5 }]);
    expect(inventory.remove(Block.Wood, 6)).toBe(false);
    expect(inventory.count(Block.Wood)).toBe(5);
    expect(inventory.remove(Block.Wood, 5)).toBe(true);
    expect(inventory.selectedItem()).toBeUndefined();
  });

  it('keeps the selected item selected when an earlier stack is removed', () => {
    const inventory = new Inventory();
    inventory.add(Block.Dirt);
    inventory.add(Block.Stone);
    inventory.add(Block.Wood);
    inventory.selected = 1;
    inventory.remove(Block.Dirt);
    expect(inventory.selectedItem()?.id).toBe(Block.Stone);
  });

  it('limits inventory to nine distinct types and rejects invalid quantities', () => {
    const inventory = new Inventory();
    for (let id = Block.Dirt; id <= Block.Scaffold; id++) expect(inventory.add(id)).toBe(true);
    expect(inventory.slots).toHaveLength(9);
    expect(inventory.add(Block.Totem)).toBe(false);
    expect(inventory.add(Block.Dirt, 2)).toBe(true);
    expect(inventory.add(Block.Air)).toBe(false);
    expect(inventory.remove(Block.Dirt, -1)).toBe(false);
  });

  it('crafts recipes atomically, including mixed totem ingredients', () => {
    const inventory = new Inventory();
    inventory.add(Block.Wood, 5);
    inventory.add(Block.Stone, 7);
    inventory.add(Block.Glitch, 1);
    inventory.add(Block.Flesh, 1);
    expect(inventory.craft('torch')).toBe(true);
    expect(inventory.count(Block.Torch)).toBe(4);
    expect(inventory.craft('weapon')).toBe(true);
    expect(inventory.weapon).toBe(true);
    expect(inventory.craft('weapon')).toBe(false);
    expect(inventory.craft('scaffold')).toBe(true);
    expect(inventory.count(Block.Scaffold)).toBe(4);
    expect(inventory.craft('totem')).toBe(true);
    expect(inventory.count(Block.Totem)).toBe(1);
    expect(inventory.count(Block.Glitch)).toBe(0);
    expect(inventory.count(Block.Flesh)).toBe(0);
    const before = JSON.stringify(inventory.slots);
    expect(inventory.craft('torch')).toBe(false);
    expect(JSON.stringify(inventory.slots)).toBe(before);
  });

  it('crafts the weapon and totem using the specified ingredients', () => {
    const inventory = new Inventory();
    inventory.add(Block.Wood, 2); inventory.add(Block.Stone, 3);
    expect(inventory.craft('weapon')).toBe(true);
    inventory.add(Block.Stone, 3); inventory.add(Block.Glitch, 1); inventory.add(Block.Flesh, 1);
    expect(inventory.craft('totem')).toBe(true);
    expect(inventory.count(Block.Stone)).toBe(0);
    expect(inventory.count(Block.Totem)).toBe(1);
  });

  it('does not spend ingredients if output cannot fit', () => {
    const inventory = new Inventory();
    for (let id = Block.Dirt; id <= Block.Scaffold; id++) inventory.add(id, 4);
    const before = JSON.stringify(inventory.slots);
    expect(inventory.craft('totem')).toBe(false);
    expect(JSON.stringify(inventory.slots)).toBe(before);
  });
});
