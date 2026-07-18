interface MobileRailScrimProps {
  open: boolean;
  label: string;
  onClose: () => void;
}

function MobileRailScrim({ open, label, onClose }: MobileRailScrimProps) {
  if (!open) return null;
  return <button type="button" class="rail-scrim" aria-label={label} onClick={onClose} />;
}

export { MobileRailScrim };
