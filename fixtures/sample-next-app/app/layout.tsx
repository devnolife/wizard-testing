export const metadata = {
  title: "Sample App",
};

// Intentional a11y issue: <html> is missing a `lang` attribute.
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html>
      <body>{children}</body>
    </html>
  );
}
