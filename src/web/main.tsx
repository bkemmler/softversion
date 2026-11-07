import { useEffect, useState, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { Overview } from "./pages/Overview.tsx";
import { Products } from "./pages/Products.tsx";
import { Releases } from "./pages/Releases.tsx";
import { Runs } from "./pages/Runs.tsx";
import { Settings } from "./pages/Settings.tsx";

const PAGES: [string, string, () => ReactNode][] = [
  ["", "Übersicht", () => <Overview />],
  ["products", "Produkte", () => <Products />],
  ["releases", "Releases", () => <Releases />],
  ["runs", "Läufe", () => <Runs />],
  ["settings", "Einstellungen", () => <Settings />],
];

function App() {
  const [hash, setHash] = useState(location.hash.slice(2));
  useEffect(() => {
    const on = () => setHash(location.hash.slice(2));
    addEventListener("hashchange", on);
    return () => removeEventListener("hashchange", on);
  }, []);
  const page = hash.split("/")[0];
  const current = PAGES.find(([k]) => k === page) ?? PAGES[0];
  return (
    <>
      <header>
        <strong>Software-Update-Tracker</strong>
        <nav>
          {PAGES.map(([k, label]) => (
            <a key={k} href={`#/${k}`} aria-current={current[0] === k ? "page" : undefined}>{label}</a>
          ))}
        </nav>
      </header>
      <main>{current[2]()}</main>
    </>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
