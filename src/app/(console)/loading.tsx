export default function ConsoleLoading() {
  return (
    <div aria-busy="true" aria-live="polite">
      <div className="top">
        <div>
          <h1 className="skeleton-line" style={{ width: 200 }}>&nbsp;</h1>
          <p className="lede skeleton-line" style={{ width: 420, marginTop: 8 }}>&nbsp;</p>
        </div>
      </div>
      <div className="grid cards" style={{ marginBottom: 20 }}>
        <div className="card">
          <div className="k">&nbsp;</div>
          <div className="v skeleton-line" style={{ width: 48 }}>&nbsp;</div>
        </div>
        <div className="card">
          <div className="k">&nbsp;</div>
          <div className="v skeleton-line" style={{ width: 48 }}>&nbsp;</div>
        </div>
        <div className="card">
          <div className="k">&nbsp;</div>
          <div className="v skeleton-line" style={{ width: 48 }}>&nbsp;</div>
        </div>
      </div>
      <div className="panel skeleton-panel" />
    </div>
  );
}
