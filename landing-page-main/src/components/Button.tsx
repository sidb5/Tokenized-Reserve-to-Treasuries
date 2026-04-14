import clsx from 'clsx'
import Link from 'next/link'

type ButtonProps = {
  invert?: boolean,
  variant?: 'flat' | 'gradient' | 'outline',
} & (
    | React.ComponentPropsWithoutRef<typeof Link>
    | (React.ComponentPropsWithoutRef<'button'> & { href?: undefined })
  )

export function Button({
  invert = false,
  variant = 'flat',
  className,
  children,
  ...props
}: ButtonProps) {
  className = clsx(
    className,
    'inline-flex h-[fit-content] rounded-lg px-5 py-2 text-sm font-semibold uppercase tracking-wide transition justify-center min-w-[8rem]',
    variant === 'flat'
      ? 'bg-neutral-950 text-white hover:bg-neutral-800'
      : '',
    variant === 'outline'
      ? 'border-2 border-neutral-950 bg-transparent hover:bg-neutral-900 hover:text-white'
      : '',
    variant === 'gradient'
      ? 'bg-gradient-to-br from-amber-300 to-yellow-800 text-white hover:from-amber-500 hover:to-yellow-900 drop-shadow-xl'
      : '',
    invert
      ? 'bg-white text-neutral-950 hover:bg-neutral-200'
      : '',
  )

  if (typeof props.href === 'undefined') {
    return (
      <button className={className} {...props}>
        {children}
      </button>
    )
  }

  return (
    <Link className={className} {...props}>
      {children}
    </Link>
  )
}
