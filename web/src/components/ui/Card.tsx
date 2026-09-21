import { motion } from 'framer-motion'
import type { ReactNode } from 'react'
import { cn } from '../../lib/cn'

interface CardProps {
  children: ReactNode
  className?: string
  /** Lift slightly and darken the border on hover. */
  interactive?: boolean
}

export function Card({ children, className, interactive = true }: CardProps) {
  return (
    <motion.div
      whileHover={interactive ? { y: -2 } : undefined}
      transition={{ duration: 0.3, ease: 'easeOut' }}
      className={cn('rounded-card border border-line bg-white transition-colors duration-300', interactive && 'hover:border-ink/50', className)}
    >
      {children}
    </motion.div>
  )
}
