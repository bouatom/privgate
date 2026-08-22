export default function ConfigurationLoading() {
  return (
    <div aria-busy="true" aria-live="polite">
      <div className="top">
        <div>
          <h1 className="skeleton-line" style={{ width: 180 }}>&nbsp;</h1>
          <p className="lede skeleton-line" style={{ width: 400, marginTop: 8 }}>&nbsp;</p>
        </div>
      </div>
      <div className="panel skeleton-panel" />
    </div>
  );
}
