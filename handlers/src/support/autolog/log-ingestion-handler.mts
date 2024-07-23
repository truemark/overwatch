export async function handler(event: unknown) {
  console.log('Something something', JSON.stringify(event, null, 2));
}
