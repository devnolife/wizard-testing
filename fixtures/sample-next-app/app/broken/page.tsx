export default function BrokenPage() {
  // Intentional crash path: this page throws during render.
  const data = null as unknown as { value: string };
  return (
    <main>
      <h1>Broken</h1>
      <p>{data.value}</p>
    </main>
  );
}
