export interface Person {
  name: string
  role: string
}

export interface CalendarEvent {
  id: string
  title: string
  /** ISO date `YYYY-MM-DD`. */
  date: string
  /** 24h `HH:MM`. */
  start: string
  end: string
  people: Person[]
  /** Memories this event relates to. Documents and decisions in the detail panel are derived from these. */
  relatedMemoryIds: string[]
}
