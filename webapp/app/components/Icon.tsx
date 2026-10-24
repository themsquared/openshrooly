/** Tiny offline stroke icons — same 1.7px round language as the gauges. */

export type IconName =
  | "alert"
  | "air"
  | "check"
  | "chevronLeft"
  | "chevronRight"
  | "heat"
  | "humidity"
  | "info"
  | "light"
  | "moon"
  | "settings"
  | "sun"
  | "temp"
  | "water"

const PATHS: Record<IconName, string> = {
  alert: "M12 4.6 20.7 19.4H3.3L12 4.6z M12 10.4v4.1 M12 16.7h.01",
  air: "M4 8.4h11.2a2.4 2.4 0 1 0-2.1-3.4 M4 12h14.2a2.4 2.4 0 1 1-2.1 3.4 M4 15.6h8.4",
  check: "M5.2 12.4 9.6 16.8 18.8 7.4",
  chevronLeft: "M14.4 6.6 8.6 12l5.8 5.4",
  chevronRight: "M9.6 6.6 15.4 12 9.6 17.4",
  heat: "M12 19.4a3.8 3.8 0 0 0 3.8-3.8c0-2.3-3.8-6.6-3.8-6.6S8.2 13.3 8.2 15.6A3.8 3.8 0 0 0 12 19.4z M12 5v3",
  humidity:
    "M12 4.8s5.8 6 5.8 10a5.8 5.8 0 1 1-11.6 0C6.2 10.8 12 4.8 12 4.8z M9.4 14.3c.5 1.5 1.7 2.3 3.1 2.3",
  info: "M12 20a8 8 0 1 0 0-16 8 8 0 0 0 0 16z M12 11.1V16 M12 8.1h.01",
  light:
    "M9.2 18.2h5.6 M10.2 21h3.6 M12 3.2v1.5 M5.5 6.5l1.1 1.1 M18.5 6.5l-1.1 1.1 M12 6.6a4.8 4.8 0 0 1 2.5 8.8v1.4H9.5v-1.4A4.8 4.8 0 0 1 12 6.6z",
  moon: "M16.5 14.7A6.1 6.1 0 0 1 9.3 7.5 6.3 6.3 0 1 0 16.5 14.7z",
  settings:
    "M12 15.2a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4z M4.8 12.8l1.8.4.8 1.7-1.1 1.6 1.6 1.6 1.6-1.1 1.7.8.4 1.8h2.2l.4-1.8 1.7-.8 1.6 1.1 1.6-1.6-1.1-1.6.8-1.7 1.8-.4v-2.2l-1.8-.4-.8-1.7 1.1-1.6-1.6-1.6-1.6 1.1-1.7-.8L13.1 4h-2.2l-.4 1.8-1.7.8-1.6-1.1-1.6 1.6 1.1 1.6-.8 1.7-1.8.4z",
  sun: "M12 16.2a4.2 4.2 0 1 0 0-8.4 4.2 4.2 0 0 0 0 8.4z M12 3.8v1.6 M12 18.6v1.6 M3.8 12h1.6 M18.6 12h1.6 M6.3 6.3l1.2 1.2 M16.5 16.5l1.2 1.2 M6.3 17.7l1.2-1.2 M16.5 7.5l1.2-1.2",
  temp: "M10.2 13.1V7.4a1.8 1.8 0 1 1 3.6 0v5.7a3.3 3.3 0 1 1-3.6 0z M12 16.4v-5.6",
  water:
    "M8.2 10.4h7.6v7.8A2.2 2.2 0 0 1 13.6 20.4H9.8A1.6 1.6 0 0 1 8.2 18.8V10.4z M10.2 10.4V8a1.8 1.8 0 0 1 3.6 0v2.4 M8.2 13.4h7.6",
}

export default function Icon({
  name,
  size = 22,
  label,
}: {
  name: IconName
  size?: number
  label?: string
}) {
  return (
    <svg
      className="sl-icon"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={label ? undefined : true}
      role={label ? "img" : undefined}
      aria-label={label}
    >
      <path d={PATHS[name]} />
    </svg>
  )
}

export function ModalTitle({ name, children }: { name: IconName; children: React.ReactNode }) {
  return (
    <h2 className="modal-title">
      <Icon name={name} size={22} />
      <span>{children}</span>
    </h2>
  )
}
