type VisibleTreeParentTrailProps = {
  trail: string[];
};

export function VisibleTreeParentTrail({ trail }: VisibleTreeParentTrailProps) {
  const label = trail.join(' / ');

  return (
    <ol aria-label="Current visible parents" className="visible-tree-parent-trail" title={label}>
      {trail.map((title, index) => (
        <li
          aria-level={index + 1}
          className="visible-tree-parent-fragment"
          key={`${title}-${index}`}
          style={{ '--visible-tree-parent-level': index } as React.CSSProperties}
        >
          <span className="visible-tree-parent-name">{title}</span>
        </li>
      ))}
    </ol>
  );
}
