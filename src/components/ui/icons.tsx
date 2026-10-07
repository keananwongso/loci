import type { SVGProps } from 'react'

function Icon({ children, ...props }: SVGProps<SVGSVGElement>) {
	return (
		<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden {...props}>
			{children}
		</svg>
	)
}

export const SelectIcon = () => (
	<Icon>
		<path d="M5 3.5 18.5 10l-6 1.8L10 18z" />
	</Icon>
)
export const HandIcon = () => (
	<Icon>
		<path d="M18 11V6.5a1.5 1.5 0 0 0-3 0V10M15 9.5V4.5a1.5 1.5 0 0 0-3 0V10M12 9.5V5.5a1.5 1.5 0 0 0-3 0V12" />
		<path d="M18 9.5a1.5 1.5 0 0 1 3 0V14a7 7 0 0 1-7 7h-1.2a7 7 0 0 1-5.4-2.6L4.2 15.6a1.6 1.6 0 0 1 2.4-2.1L9 15.5V8" />
	</Icon>
)
export const PenIcon = () => (
	<Icon>
		<path d="M4 20c2.5-.3 4-1 5.5-2.5L20 7a2.1 2.1 0 0 0-3-3L6.5 14.5C5 16 4.3 17.5 4 20z" />
	</Icon>
)
export const TextIcon = () => (
	<Icon>
		<path d="M5 6V4.5h14V6M12 4.5v15M9 19.5h6" />
	</Icon>
)
export const RectIcon = () => (
	<Icon>
		<rect x="4" y="5" width="16" height="14" rx="2.5" />
	</Icon>
)
export const ArrowIcon = () => (
	<Icon>
		<path d="M5 19 19 5M9 5h10v10" />
	</Icon>
)
export const EraserIcon = () => (
	<Icon>
		<path d="m7 21-3.6-3.6a2 2 0 0 1 0-2.8L13.6 4.4a2 2 0 0 1 2.8 0l4.2 4.2a2 2 0 0 1 0 2.8L11 21zM21 21H7M9 11l6 6" />
	</Icon>
)
export const RegionIcon = () => (
	<Icon>
		<path d="M4 8V5.5A1.5 1.5 0 0 1 5.5 4H8M16 4h2.5A1.5 1.5 0 0 1 20 5.5V8M20 16v2.5a1.5 1.5 0 0 1-1.5 1.5H16M8 20H5.5A1.5 1.5 0 0 1 4 18.5V16" />
		<path d="M10.5 10.2a1.8 1.8 0 1 1 2.3 2c-.5.2-.8.6-.8 1.1M12 15.4v.1" />
	</Icon>
)
export const UploadIcon = () => (
	<Icon>
		<path d="M12 15V4M7.5 8.5 12 4l4.5 4.5M5 14v4.5A1.5 1.5 0 0 0 6.5 20h11a1.5 1.5 0 0 0 1.5-1.5V14" />
	</Icon>
)
export const SendIcon = () => (
	<Icon strokeWidth={2.2}>
		<path d="M12 19V5M6 11l6-6 6 6" />
	</Icon>
)
export const StopIcon = () => (
	<Icon>
		<rect x="7" y="7" width="10" height="10" rx="2" fill="currentColor" stroke="none" />
	</Icon>
)
export const MicIcon = () => (
	<Icon>
		<rect x="9" y="3" width="6" height="11" rx="3" />
		<path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" />
	</Icon>
)
export const SpeakerIcon = ({ off }: { off?: boolean }) => (
	<Icon>
		<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" />
		{off ? <path d="m16 9.5 5 5M21 9.5l-5 5" /> : <path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11" />}
	</Icon>
)
export const UndoIcon = () => (
	<Icon>
		<path d="M9 14 4 9l5-5" />
		<path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />
	</Icon>
)
export const CloseIcon = () => (
	<Icon>
		<path d="M6 6l12 12M18 6 6 18" />
	</Icon>
)
export const HistoryIcon = () => (
	<Icon>
		<path d="M3.5 12a8.5 8.5 0 1 0 2.5-6L3.5 8.5" />
		<path d="M3.5 4v4.5H8M12 7.5V12l3 2" />
	</Icon>
)
export const MoreIcon = () => (
	<Icon>
		<circle cx="5.5" cy="12" r="1" fill="currentColor" />
		<circle cx="12" cy="12" r="1" fill="currentColor" />
		<circle cx="18.5" cy="12" r="1" fill="currentColor" />
	</Icon>
)
export const PageIcon = () => (
	<Icon width={14} height={14}>
		<path d="M14 3.5H7A1.5 1.5 0 0 0 5.5 5v14A1.5 1.5 0 0 0 7 20.5h10a1.5 1.5 0 0 0 1.5-1.5V8z" />
		<path d="M14 3.5V8h4.5" />
	</Icon>
)
export const LayersIcon = () => (
	<Icon width={14} height={14}>
		<path d="m12 4 8.5 4.5L12 13 3.5 8.5z" />
		<path d="m3.5 12.5 8.5 4.5 8.5-4.5" />
	</Icon>
)
export const NewBoardIcon = () => (
	<Icon>
		<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9" />
		<path d="M18 2v6M15 5h6" />
	</Icon>
)

export const TrashIcon = () => <Icon><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 10v7M14 10v7" /></Icon>
export const SkipIcon = ({ forward = false }: { forward?: boolean }) => <Icon style={forward ? { transform: 'scaleX(-1)' } : undefined}><path d="M4 9V4m0 5h5M4 9a8 8 0 1 1-1 7" /></Icon>
export const PlayIcon = () => <Icon><path d="m9 5 11 7-11 7z" fill="currentColor" stroke="none" /></Icon>
export const PauseIcon = () => <Icon><path d="M9 6v12M15 6v12" strokeWidth={3} /></Icon>

export const KeyboardIcon = () => (
 <Icon><rect x="2" y="5" width="20" height="14" rx="3" /><path d="M6 9h.01M10 9h.01M14 9h.01M18 9h.01M6 12h.01M10 12h.01M14 12h.01M18 12h.01M7 15h10" /></Icon>
)

export const BookIcon = () => (<Icon><path d="M12 5v15M12 5C9 3 5 3 2 4v15c3-1 7-1 10 1 3-2 7-2 10-1V4c-3-1-7-1-10 1Z" /></Icon>)
