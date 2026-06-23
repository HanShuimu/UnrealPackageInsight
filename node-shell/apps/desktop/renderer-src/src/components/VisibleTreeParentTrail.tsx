type VisibleTreeParentTrailProps = {
  trail: string[];
};

export function VisibleTreeParentTrail({ trail }: VisibleTreeParentTrailProps) {
  const label = trail.join(' / ');

  return (
    <div aria-label="Current visible parents" className="visible-tree-parent-trail" title={label}>
      {trail.map((title, index) => (
        <span className="visible-tree-parent-fragment" key={`${title}-${index}`}>
          {index > 0 ? <span className="visible-tree-parent-separator">/</span> : null}
          <span className="visible-tree-parent-name">{title}</span>
        </span>
      ))}
    </div>
  );
}
