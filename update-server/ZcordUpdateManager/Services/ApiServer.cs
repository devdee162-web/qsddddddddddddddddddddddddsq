using System.IO;
using System.Net;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using ZcordUpdateManager.Models;

namespace ZcordUpdateManager.Services;

public sealed class ApiServer : IDisposable
{
    private readonly UpdateService _service;
    private HttpListener? _listener;
    private CancellationTokenSource? _cts;
    private Task? _loop;

    public ApiServer(UpdateService service) => _service = service;

    public int Start(int preferredPort = 8743)
    {
        for (var port = preferredPort; port < preferredPort + 8; port++)
        {
            var listener = new HttpListener();
            try
            {
                listener.Prefixes.Add($"http://127.0.0.1:{port}/");
                listener.Start();
                _listener = listener;
                _cts = new CancellationTokenSource();
                _loop = Task.Run(() => LoopAsync(_cts.Token));
                return port;
            }
            catch
            {
                try { listener.Stop(); } catch { }
                listener.Close();
            }
        }
        throw new InvalidOperationException("Aucun port API disponible (8743-8750)");
    }

    private async Task LoopAsync(CancellationToken ct)
    {
        while (!ct.IsCancellationRequested)
        {
            HttpListenerContext ctx;
            try { ctx = await _listener!.GetContextAsync().WaitAsync(ct).ConfigureAwait(false); }
            catch when (ct.IsCancellationRequested) { break; }
            catch { continue; }

            _ = Task.Run(() => HandleRequest(ctx));
        }
    }

    private void HandleRequest(HttpListenerContext ctx)
    {
        try
        {
            var req = ctx.Request;
            var path = req.Url?.AbsolutePath ?? "/";
            var method = req.HttpMethod.ToUpperInvariant();

            if (method == "GET" && path == "/api/stats")
                WriteJson(ctx, _service.GetStats());
            else if (method == "GET" && path == "/api/updates")
                WriteJson(ctx, _service.GetUpdates());
            else if (method == "POST" && path == "/api/updates")
                WriteJson(ctx, _service.CreateUpdate(ReadBody<CreateReleaseRequest>(req)!));
            else if (method == "POST" && path.StartsWith("/api/updates/") && path.EndsWith("/publish"))
            {
                var id = path.Split('/')[3];
                WriteJson(ctx, _service.PublishUpdateAsync(id).GetAwaiter().GetResult());
            }
            else if (method == "GET" && path == "/api/check")
                WriteJson(ctx, _service.CheckUpdate(req.QueryString["version"]));
            else if (method == "GET" && path == "/api/update.json")
            {
                var p = Path.Combine(_service.ReleaseDir, "update.json");
                if (!File.Exists(p)) { ctx.Response.StatusCode = 404; ctx.Response.Close(); return; }
                WriteRaw(ctx, File.ReadAllText(p), "application/json");
            }
            else if (method == "POST" && path == "/api/report")
                WriteJson(ctx, _service.ReportClient(JsonNode.Parse(ReadText(req))!));
            else if (method == "GET" && path == "/api/history")
                WriteJson(ctx, _service.GetHistory());
            else if (method == "GET" && path == "/api/logs")
                WriteJson(ctx, _service.GetLogs());
            else if (method == "GET" && path == "/api/settings")
                WriteJson(ctx, _service.GetSettings());
            else
            {
                ctx.Response.StatusCode = 404;
                WriteJson(ctx, new { error = "not found" });
            }
        }
        catch (Exception ex)
        {
            ctx.Response.StatusCode = 500;
            WriteJson(ctx, new { error = ex.Message });
        }
    }

    private static T? ReadBody<T>(HttpListenerRequest req)
    {
        var json = ReadText(req);
        return JsonSerializer.Deserialize<T>(json, new JsonSerializerOptions { PropertyNameCaseInsensitive = true });
    }

    private static string ReadText(HttpListenerRequest req)
    {
        using var reader = new StreamReader(req.InputStream, req.ContentEncoding);
        return reader.ReadToEnd();
    }

    private static void WriteJson(HttpListenerContext ctx, object data)
    {
        var json = JsonSerializer.Serialize(data, new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.CamelCase });
        WriteRaw(ctx, json, "application/json");
    }

    private static void WriteRaw(HttpListenerContext ctx, string body, string contentType)
    {
        var bytes = Encoding.UTF8.GetBytes(body);
        ctx.Response.ContentType = contentType;
        ctx.Response.ContentEncoding = Encoding.UTF8;
        ctx.Response.ContentLength64 = bytes.Length;
        ctx.Response.OutputStream.Write(bytes);
        ctx.Response.Close();
    }

    public void Dispose()
    {
        _cts?.Cancel();
        if (_listener != null)
        {
            try { _listener.Stop(); } catch { }
            _listener.Close();
        }
    }
}
