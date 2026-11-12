export class MemorySave {
  private readonly slots = new Map<string, string>();

  write(slot: string, value: unknown): number {
    const text = JSON.stringify(value);
    this.slots.set(slot, text);
    return text.length;
  }

  read(slot: string): string | undefined {
    return this.slots.get(slot);
  }
}
