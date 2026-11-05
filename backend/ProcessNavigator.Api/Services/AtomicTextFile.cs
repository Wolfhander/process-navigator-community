using System.Text;

namespace ProcessNavigator.Api.Services;

public static class AtomicTextFile
{
    public static async Task WriteAsync(string path,string content,CancellationToken cancellationToken=default)
    {
        var temporary=path+"."+Guid.NewGuid().ToString("N")+".tmp";
        try
        {
            await File.WriteAllTextAsync(temporary,content,new UTF8Encoding(false),cancellationToken);
            cancellationToken.ThrowIfCancellationRequested();
            File.Move(temporary,path,true);
        }
        finally {if(File.Exists(temporary))File.Delete(temporary);}
    }
}
