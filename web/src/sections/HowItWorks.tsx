import { motion } from 'framer-motion'
import { HOW_IT_WORKS } from '../config/site'

const column = {
  hidden: { opacity: 0, y: 16 },
  show: { opacity: 1, y: 0, transition: { duration: 0.45, ease: 'easeOut' as const } },
}

/** Three equal columns with hairline dividers; the columns stagger in. */
export function HowItWorks() {
  return (
    <motion.ol
      initial="hidden"
      animate="show"
      transition={{ staggerChildren: 0.12 }}
      className="grid divide-y divide-line border-y border-line md:grid-cols-3 md:divide-x md:divide-y-0"
    >
      {HOW_IT_WORKS.map((step) => (
        <motion.li key={step.number} variants={column} className="py-8 md:px-8 md:py-10 md:first:pl-0 md:last:pr-0">
          <p className="font-mono text-sm text-muted">
            {step.number} <span className="ml-1 text-ink">{step.title}</span>
          </p>
          <p className="mt-6 max-w-xs font-display text-xl leading-snug tracking-tight text-ink sm:text-2xl">{step.body}</p>
        </motion.li>
      ))}
    </motion.ol>
  )
}
