import Link from "next/link";

export default function HomePage() {
  return (
    <main>
      <h1>Sample App Home</h1>
      {/* Intentional a11y issue: image without alt text. */}
      <img src="/logo.png" width={80} height={80} />
      <nav>
        <ul>
          <li>
            <Link href="/login">Login</Link>
          </li>
          <li>
            <Link href="/broken">Broken page</Link>
          </li>
        </ul>
      </nav>
    </main>
  );
}
