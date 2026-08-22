export function Forbidden({ message }: { message?: string }) {
  return (
    <>
      <div className="top">
        <div>
          <h1>Access denied</h1>
          <p className="lede">{message || "Your role does not include this page."}</p>
        </div>
      </div>
    </>
  );
}
