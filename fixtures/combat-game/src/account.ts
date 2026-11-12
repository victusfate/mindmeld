export function login(user: { name: string; password: string }): string {
  return `welcome ${user.name}`;
}
